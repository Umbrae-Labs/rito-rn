#include "HybridRitoNitro.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstring>
#include <functional>
#include <optional>
#include <stdexcept>
#include <utility>

#include "RitoAbiExtensions.h"
#include "RitoOwnedBuffer.h"
#include "RitoPinnedFontAbi.h"

namespace margelo::nitro::ritonitro {
namespace {
using ritojs::reactnative::RitoFfiResult;

constexpr std::uint64_t kMaximumExternalId = 0x7fff'ffff'ffff'ffffULL;
constexpr std::uint64_t kMaximumPublicationBytes = 512ULL * 1024ULL * 1024ULL;
constexpr std::uint64_t kMaximumRequestBytes = 16ULL * 1024ULL * 1024ULL;
constexpr std::uint64_t kMaximumPinnedFontBytes = 64ULL * 1024ULL * 1024ULL;

std::shared_ptr<ArrayBuffer> emptyBuffer() {
  return ArrayBuffer::move(std::vector<std::uint8_t>{});
}

RitoNitroResult toNativeResult(RitoFfiResult result) {
  return RitoNitroResult(static_cast<double>(result.status), ArrayBuffer::move(std::move(result.data)), std::move(result.error));
}

RitoNitroResult invalidResult(std::string message) {
  return RitoNitroResult(static_cast<double>(RITO_STATUS_INVALID_ARGUMENT), emptyBuffer(), std::move(message));
}

RitoNitroResult busyResult() {
  return RitoNitroResult(static_cast<double>(RITO_STATUS_BUSY), emptyBuffer(), "The Rito Nitro executor queue is full.");
}

std::uint64_t parseExternalId(const std::string& value, const char* field) {
  if (value.empty()) throw std::invalid_argument(std::string(field) + " must be a positive decimal integer.");
  std::uint64_t result{};
  const auto [pointer, error] = std::from_chars(value.data(), value.data() + value.size(), result, 10);
  if (error != std::errc{} || pointer != value.data() + value.size() || result == 0 || result > kMaximumExternalId) {
    throw std::invalid_argument(std::string(field) + " must be within 1..=INT64_MAX.");
  }
  return result;
}

std::vector<std::uint8_t> copyBinary(const std::shared_ptr<ArrayBuffer>& input, std::uint64_t maximum, const char* field) {
  if (!input) throw std::invalid_argument(std::string(field) + " must not be null.");
  const auto length = input->size();
  if (length > maximum) throw std::invalid_argument(std::string(field) + " exceeds its ABI limit.");
  const auto* data = input->data();
  if (length != 0 && data == nullptr) throw std::invalid_argument(std::string(field) + " has no accessible data.");
  if (length == 0) return {};
  return {data, data + length};
}

std::array<std::uint8_t, 64> parseDigest(const std::string& digest) {
  if (digest.size() != 64) throw std::invalid_argument("Pinned font SHA-256 must contain 64 hexadecimal digits.");
  std::array<std::uint8_t, 64> result{};
  for (std::size_t index = 0; index < digest.size(); ++index) {
    const char value = digest[index];
    if (!((value >= '0' && value <= '9') || (value >= 'a' && value <= 'f'))) {
      throw std::invalid_argument("Pinned font SHA-256 must use lowercase hexadecimal digits.");
    }
    result[index] = static_cast<std::uint8_t>(value);
  }
  return result;
}

struct OwnedPinnedFont final {
  std::vector<std::uint8_t> bytes;
  std::array<std::uint8_t, 64> digest{};
  std::optional<std::string> language;
  std::uint32_t role{};

  rito_pinned_font_face toFfi() const {
    rito_pinned_font_face result{};
    result.bytes_data = bytes.data();
    result.bytes_len = bytes.size();
    std::memcpy(result.sha256_hex, digest.data(), digest.size());
    result.generic_role = role;
    result.language_data = language ? reinterpret_cast<const std::uint8_t*>(language->data()) : nullptr;
    result.language_len = language ? language->size() : 0;
    return result;
  }
};

std::vector<OwnedPinnedFont> copyFonts(const std::vector<RitoNitroPinnedFontFace>& faces) {
  if (faces.empty()) throw std::invalid_argument("Rito requires at least one pinned font face.");
  std::vector<OwnedPinnedFont> result;
  result.reserve(faces.size());
  for (const auto& face : faces) {
    const auto role = static_cast<std::uint32_t>(face.genericRole);
    if (role > RITO_PINNED_FONT_ROLE_MONOSPACE) throw std::invalid_argument("Pinned font has an unsupported generic role.");
    result.push_back({copyBinary(face.bytes, kMaximumPinnedFontBytes, "Pinned font bytes"), parseDigest(face.expectedSha256), face.language, role});
  }
  return result;
}

template <typename Operation>
std::shared_ptr<Promise<RitoNitroResult>> submit(ritojs::reactnative::RitoExecutor& executor, Operation operation) {
  auto promise = Promise<RitoNitroResult>::create();
  if (!executor.submit([promise, operation = std::move(operation)]() mutable {
        try {
          promise->resolve(toNativeResult(operation()));
        } catch (const std::exception& exception) {
          promise->resolve(invalidResult(exception.what()));
        } catch (...) {
          promise->resolve(invalidResult("Rito native operation failed with an unknown exception."));
        }
      })) {
    promise->resolve(busyResult());
  }
  return promise;
}

template <typename Operation>
std::shared_ptr<Promise<RitoNitroResult>> submitChecked(ritojs::reactnative::RitoExecutor& executor, Operation operation) {
  try {
    return submit(executor, std::move(operation));
  } catch (const std::exception& exception) {
    return Promise<RitoNitroResult>::resolved(invalidResult(exception.what()));
  }
}

RitoFfiResult invokeOpen(std::vector<std::uint8_t> publication, std::vector<std::uint8_t> request, std::vector<OwnedPinnedFont> fonts) {
  std::vector<rito_pinned_font_face> ffiFonts;
  ffiFonts.reserve(fonts.size());
  for (const auto& font : fonts) ffiFonts.push_back(font.toFfi());
  rito_owned_buffer artifact{};
  rito_owned_buffer error{};
  const auto status = rito_open_with_pinned_fonts(publication.data(), publication.size(), request.data(), request.size(), ffiFonts.data(), static_cast<std::uint32_t>(ffiFonts.size()), &artifact, &error);
  return ritojs::reactnative::collectRitoResult(status, &artifact, &error);
}

using WireOperation = std::uint32_t (*)(std::uint64_t, const std::uint8_t*, std::uint64_t, rito_owned_buffer*, rito_owned_buffer*);

constexpr std::uint64_t kShardKeyBytes = 32;
constexpr double kMaximumPaperTurnIds = 65536;
constexpr double kMaximumSheetFloats = 64.0 * 1024.0 * 1024.0;

std::vector<std::uint8_t> copyShardKey(const std::shared_ptr<ArrayBuffer>& key) {
  auto bytes = copyBinary(key, kShardKeyBytes, "shard key");
  if (!bytes.empty() && bytes.size() != kShardKeyBytes) throw std::invalid_argument("A shard key must be empty or 32 bytes.");
  return bytes;
}

std::vector<rito_pinned_font_face> ffiFaces(const std::vector<OwnedPinnedFont>& fonts) {
  std::vector<rito_pinned_font_face> result;
  result.reserve(fonts.size());
  for (const auto& font : fonts) result.push_back(font.toFfi());
  return result;
}

/** A call whose only output is its status and diagnostic. */
RitoFfiResult statusOnly(std::uint32_t status, rito_owned_buffer* error) {
  rito_owned_buffer output{};
  return ritojs::reactnative::collectRitoResult(status, &output, error);
}

/** Little-endian u32 values, as the wire carries them. */
std::vector<std::uint8_t> littleEndian(const std::uint32_t* values, std::size_t count) {
  std::vector<std::uint8_t> bytes(count * 4);
  for (std::size_t index = 0; index < count; ++index) {
    for (std::size_t shift = 0; shift < 4; ++shift) bytes[index * 4 + shift] = static_cast<std::uint8_t>(values[index] >> (shift * 8));
  }
  return bytes;
}

/** Throws the diagnostic of a failed synchronous call; frees the error buffer either way. */
void requireOk(std::uint32_t status, rito_owned_buffer* error, const char* operation) {
  if (status == RITO_STATUS_OK) {
    rito_buffer_free(error);
    return;
  }
  std::string message;
  try {
    message = ritojs::reactnative::copyOwnedError(error);
  } catch (...) {
    message.clear();
  }
  if (message.empty()) message = "failed with status " + std::to_string(status) + ".";
  throw std::runtime_error(std::string("Rito ") + operation + ": " + message);
}

std::uint32_t requireCount(double value, double maximum, const char* field) {
  if (!std::isfinite(value) || value < 0 || value > maximum || std::floor(value) != value) {
    throw std::invalid_argument(std::string(field) + " must be an integer within 0..=" + std::to_string(static_cast<std::uint64_t>(maximum)) + ".");
  }
  return static_cast<std::uint32_t>(value);
}

std::uint64_t requireEpoch(double value) {
  if (!std::isfinite(value) || value < 0 || value > 9007199254740991.0 || std::floor(value) != value) {
    throw std::invalid_argument("A paper turn epoch must be a non-negative safe integer.");
  }
  return static_cast<std::uint64_t>(value);
}

void requireLength(const std::vector<double>& numbers, std::uint32_t length, const char* field) {
  if (numbers.size() != length) throw std::invalid_argument(std::string(field) + " must hold " + std::to_string(length) + " numbers.");
}

std::vector<double> leafIds(const std::vector<std::uint32_t>& leaves, std::uint32_t count) {
  return {leaves.begin(), leaves.begin() + static_cast<std::ptrdiff_t>(std::min<std::size_t>(count, leaves.size()))};
}

std::shared_ptr<ArrayBuffer> floatBuffer(const std::vector<float>& values) {
  std::vector<std::uint8_t> bytes(values.size() * sizeof(float));
  if (!bytes.empty()) std::memcpy(bytes.data(), values.data(), bytes.size());
  return ArrayBuffer::move(std::move(bytes));
}

RitoFfiResult invokeWire(std::uint64_t session, std::vector<std::uint8_t> request, WireOperation operation) {
  rito_owned_buffer output{};
  rito_owned_buffer error{};
  const auto status = operation(session, request.data(), request.size(), &output, &error);
  return ritojs::reactnative::collectRitoResult(status, &output, &error);
}
}  // namespace

HybridRitoNitro::HybridRitoNitro() : HybridObject(TAG), HybridRitoNitroSpec() {}
HybridRitoNitro::~HybridRitoNitro() { executor_.close(); }

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::open(const std::shared_ptr<ArrayBuffer>& publication, const std::shared_ptr<ArrayBuffer>& request, const std::vector<RitoNitroPinnedFontFace>& fonts) {
  return submitChecked(executor_, [publication = copyBinary(publication, kMaximumPublicationBytes, "publication"), request = copyBinary(request, kMaximumRequestBytes, "request"), fonts = copyFonts(fonts)]() mutable {
    return invokeOpen(std::move(publication), std::move(request), std::move(fonts));
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::readPublication(const std::string& sessionId) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId")] {
    rito_owned_buffer output{}; rito_owned_buffer error{};
    return ritojs::reactnative::collectRitoResult(rito_read_publication(session, &output, &error), &output, &error);
  });
}

#define RITO_WIRE_METHOD(name, ffi) \
std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::name(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) { \
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), request = copyBinary(request, kMaximumRequestBytes, "request")]() mutable { return invokeWire(session, std::move(request), ffi); }); \
}

RITO_WIRE_METHOD(requestArtifact, rito_request_artifact)
RITO_WIRE_METHOD(requestAdjacent, rito_request_adjacent)
RITO_WIRE_METHOD(peekAdjacent, rito_peek_adjacent)
RITO_WIRE_METHOD(adoptForeground, rito_adopt_foreground_candidate)
RITO_WIRE_METHOD(commitPeekedArtifact, rito_commit_peeked_artifact)
RITO_WIRE_METHOD(advanceBackground, rito_advance_background)
RITO_WIRE_METHOD(adoptBackground, rito_adopt_background_candidate)
RITO_WIRE_METHOD(search, rito_search)
RITO_WIRE_METHOD(textRangeGeometry, rito_get_text_range_geometry)
RITO_WIRE_METHOD(resolveExactSourceRange, rito_resolve_exact_source_range)
RITO_WIRE_METHOD(peekSpread, rito_peek_spread)
RITO_WIRE_METHOD(resolveTextInteraction, rito_resolve_text_interaction)
RITO_WIRE_METHOD(resolveAnnotation, rito_resolve_annotation)
RITO_WIRE_METHOD(resolveNavigation, rito_resolve_navigation)

#undef RITO_WIRE_METHOD

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::readResource(const std::string& sessionId, const std::string& artifactId, double kind, const std::string& href) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), artifact = parseExternalId(artifactId, "artifactId"), kind, href] {
    if (!std::isfinite(kind) || kind < RITO_RESOURCE_KIND_IMAGE || kind > RITO_RESOURCE_KIND_STYLESHEET || std::floor(kind) != kind) throw std::invalid_argument("resource kind must be an integer declared by rito-ffi.");
    if (href.empty()) throw std::invalid_argument("resource href must not be empty.");
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_read_resource(session, artifact, static_cast<std::uint32_t>(kind), reinterpret_cast<const std::uint8_t*>(href.data()), href.size(), &output, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::readPage(const std::string& sessionId, const std::string& artifactId, double pageIndex) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), artifact = parseExternalId(artifactId, "artifactId"), pageIndex] {
    if (!std::isfinite(pageIndex) || pageIndex < 0 || pageIndex > 0xffff'ffffU || std::floor(pageIndex) != pageIndex) throw std::invalid_argument("page index must be a u32.");
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_read_page(session, artifact, static_cast<std::uint32_t>(pageIndex), &output, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::readFootnote(const std::string& sessionId, const std::string& artifactId, const std::string& key) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), artifact = parseExternalId(artifactId, "artifactId"), key] {
    if (key.empty()) throw std::invalid_argument("footnote key must not be empty.");
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_read_footnote(session, artifact, reinterpret_cast<const std::uint8_t*>(key.data()), key.size(), &output, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::releaseArtifact(const std::string& sessionId, const std::string& artifactId) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), artifact = parseExternalId(artifactId, "artifactId")] {
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_release_artifact(session, artifact, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::openWithoutPinnedFonts(const std::shared_ptr<ArrayBuffer>& publication, const std::shared_ptr<ArrayBuffer>& request) {
  return submitChecked(executor_, [publication = copyBinary(publication, kMaximumPublicationBytes, "publication"), request = copyBinary(request, kMaximumRequestBytes, "request")]() mutable {
    rito_owned_buffer artifact{}; rito_owned_buffer error{};
    const auto status = rito_open(publication.data(), publication.size(), request.data(), request.size(), &artifact, &error);
    return ritojs::reactnative::collectRitoResult(status, &artifact, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::openShards(const std::shared_ptr<ArrayBuffer>& skeleton, const std::shared_ptr<ArrayBuffer>& key, const std::shared_ptr<ArrayBuffer>& request, const std::vector<RitoNitroPinnedFontFace>& fonts) {
  return submitChecked(executor_, [skeleton = copyBinary(skeleton, kMaximumPublicationBytes, "skeleton"), key = copyShardKey(key), request = copyBinary(request, kMaximumRequestBytes, "request"), fonts = copyFonts(fonts)]() mutable {
    const auto faces = ffiFaces(fonts);
    rito_owned_buffer artifact{}; rito_owned_buffer error{};
    const auto status = rito_open_shards_with_pinned_fonts(skeleton.data(), skeleton.size(), key.empty() ? nullptr : key.data(), key.size(), request.data(), request.size(), faces.data(), static_cast<std::uint32_t>(faces.size()), &artifact, &error);
    return ritojs::reactnative::collectRitoResult(status, &artifact, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::supplyShard(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& shard, const std::shared_ptr<ArrayBuffer>& key) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), shard = copyBinary(shard, kMaximumPublicationBytes, "shard"), key = copyShardKey(key)]() mutable {
    if (shard.empty()) throw std::invalid_argument("A shard must not be empty.");
    std::uint32_t shardId = 0;
    rito_owned_buffer error{};
    const auto status = rito_supply_shard(session, shard.data(), shard.size(), key.empty() ? nullptr : key.data(), key.size(), &shardId, &error);
    auto result = statusOnly(status, &error);
    if (result.status == RITO_STATUS_OK) result.data = littleEndian(&shardId, 1);
    return result;
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::contentShardsNear(const std::string& sessionId, const std::string& href) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), href] {
    if (href.empty()) throw std::invalid_argument("content shard href must not be empty.");
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_content_shards_near(session, reinterpret_cast<const std::uint8_t*>(href.data()), href.size(), &output, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::fontCatalog(const std::string& sessionId) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId")] {
    rito_owned_buffer output{}; rito_owned_buffer error{};
    return ritojs::reactnative::collectRitoResult(rito_font_catalog(session, &output, &error), &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::unresolvedFontFamilies(const std::string& sessionId, const std::string& list) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), list] {
    if (list.size() > kMaximumRequestBytes) throw std::invalid_argument("font-family list exceeds its ABI limit.");
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_unresolved_font_families(session, reinterpret_cast<const std::uint8_t*>(list.data()), list.size(), &output, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::addHostFontFaces(const std::string& sessionId, const std::vector<RitoNitroPinnedFontFace>& fonts) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), fonts = copyFonts(fonts)] {
    const auto faces = ffiFaces(fonts);
    rito_owned_buffer error{};
    return statusOnly(rito_add_host_font_faces(session, faces.data(), static_cast<std::uint32_t>(faces.size()), &error), &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::removeHostFontFaces(const std::string& sessionId, const std::vector<std::string>& sha256) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), sha256] {
    if (sha256.empty()) throw std::invalid_argument("At least one font digest is required.");
    std::vector<std::uint8_t> digests;
    digests.reserve(sha256.size() * 64);
    for (const auto& digest : sha256) {
      const auto parsed = parseDigest(digest);
      digests.insert(digests.end(), parsed.begin(), parsed.end());
    }
    rito_owned_buffer error{};
    return statusOnly(rito_remove_host_font_faces(session, digests.data(), static_cast<std::uint32_t>(sha256.size()), &error), &error);
  });
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::markFontFamilyUnavailable(const std::string& sessionId, const std::string& family) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId"), family] {
    if (family.empty()) throw std::invalid_argument("font family must not be empty.");
    rito_owned_buffer error{};
    return statusOnly(rito_mark_font_family_unavailable(session, reinterpret_cast<const std::uint8_t*>(family.data()), family.size(), &error), &error);
  });
}

// The paper turn's model runs synchronously on the calling thread: a host
// steps it once a frame, so it never waits behind a session's actor.

std::vector<double> HybridRitoNitro::paperTurnLayouts() {
  std::array<std::uint32_t, 7> layouts{};
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_layouts(layouts.data(), &error), &error, "paperTurnLayouts");
  return {layouts.begin(), layouts.end()};
}

std::string HybridRitoNitro::paperTurnNew() {
  std::uint64_t turn = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_new(&turn, &error), &error, "paperTurnNew");
  return std::to_string(turn);
}

void HybridRitoNitro::paperTurnFree(const std::string& turn) {
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_free(parseExternalId(turn, "turn"), &error), &error, "paperTurnFree");
}

RitoNitroPaperTurnLeaves HybridRitoNitro::paperTurnBegin(const std::string& turn, const std::vector<double>& frame, double leavesCapacity) {
  requireLength(frame, RITO_PAPER_TURN_FRAME_NUMBERS, "A paper turn frame");
  std::vector<double> begun(RITO_PAPER_TURN_BEGUN_NUMBERS);
  std::vector<std::uint32_t> leaves(requireCount(leavesCapacity, kMaximumPaperTurnIds, "leavesCapacity"));
  std::uint32_t count = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_begin(parseExternalId(turn, "turn"), frame.data(), begun.data(), leaves.data(), static_cast<std::uint32_t>(leaves.size()), &count, &error), &error, "paperTurnBegin");
  return RitoNitroPaperTurnLeaves(std::move(begun), leafIds(leaves, count));
}

RitoNitroPaperTurnLeaves HybridRitoNitro::paperTurnLay(const std::string& turn, double epoch, double leavesCapacity) {
  std::vector<double> laid(RITO_PAPER_TURN_LAID_NUMBERS);
  std::vector<std::uint32_t> leaves(requireCount(leavesCapacity, kMaximumPaperTurnIds, "leavesCapacity"));
  std::uint32_t count = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_lay(parseExternalId(turn, "turn"), requireEpoch(epoch), laid.data(), leaves.data(), static_cast<std::uint32_t>(leaves.size()), &count, &error), &error, "paperTurnLay");
  return RitoNitroPaperTurnLeaves(std::move(laid), leafIds(leaves, count));
}

RitoNitroPaperTurnSheet HybridRitoNitro::paperTurnSheet(const std::string& turn, double index, double pointsCapacity) {
  const auto sheetIndex = requireCount(index, 4294967295.0, "sheet index");
  const auto capacity = requireCount(pointsCapacity, kMaximumSheetFloats, "pointsCapacity");
  std::vector<double> numbers(RITO_PAPER_TURN_SHEET_NUMBERS);
  std::vector<float> positions(capacity);
  std::vector<float> normals(capacity);
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_sheet(parseExternalId(turn, "turn"), sheetIndex, numbers.data(), capacity == 0 ? nullptr : positions.data(), capacity == 0 ? nullptr : normals.data(), capacity, &error), &error, "paperTurnSheet");
  if (capacity == 0) return RitoNitroPaperTurnSheet(std::move(numbers), std::nullopt, std::nullopt);
  return RitoNitroPaperTurnSheet(std::move(numbers), floatBuffer(positions), floatBuffer(normals));
}

RitoNitroPaperTurnForgotten HybridRitoNitro::paperTurnForget(const std::string& turn, double epoch, double leavesCapacity) {
  std::uint32_t release = 0;
  std::vector<std::uint32_t> leaves(requireCount(leavesCapacity, kMaximumPaperTurnIds, "leavesCapacity"));
  std::uint32_t count = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_forget(parseExternalId(turn, "turn"), requireEpoch(epoch), &release, leaves.data(), static_cast<std::uint32_t>(leaves.size()), &count, &error), &error, "paperTurnForget");
  return RitoNitroPaperTurnForgotten(release != 0, leafIds(leaves, count));
}

std::vector<double> HybridRitoNitro::paperTurnState(const std::string& turn, double now) {
  std::vector<double> state(RITO_PAPER_TURN_STATE_NUMBERS);
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_state(parseExternalId(turn, "turn"), now, state.data(), &error), &error, "paperTurnState");
  return state;
}

std::vector<double> HybridRitoNitro::paperTurnBegins(const std::string& turn, double dx, double velocity, bool sameSpreads) {
  std::vector<double> begins(2);
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_begins(parseExternalId(turn, "turn"), dx, velocity, sameSpreads ? 1 : 0, begins.data(), &error), &error, "paperTurnBegins");
  return begins;
}

std::vector<double> HybridRitoNitro::paperTurnSettle(const std::string& turn, double from, double velocity, double to) {
  std::vector<double> settle(RITO_PAPER_TURN_SETTLE_NUMBERS);
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_settle(parseExternalId(turn, "turn"), from, velocity, to, settle.data(), &error), &error, "paperTurnSettle");
  return settle;
}

RitoNitroPaperTurnSettleStep HybridRitoNitro::paperTurnSettleStep(const std::string& turn, const std::vector<double>& settle, double seconds, double now) {
  requireLength(settle, RITO_PAPER_TURN_SETTLE_NUMBERS, "A paper turn settle");
  std::vector<double> held = settle;
  std::vector<double> at(3);
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_settle_step(parseExternalId(turn, "turn"), held.data(), seconds, now, at.data(), &error), &error, "paperTurnSettleStep");
  return RitoNitroPaperTurnSettleStep(std::move(held), std::move(at));
}

double HybridRitoNitro::paperTurnTravel(const std::vector<double>& touch, double width, double spine) {
  requireLength(touch, 4, "A paper turn touch");
  double travel = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_travel(touch.data(), width, spine, &travel, &error), &error, "paperTurnTravel");
  return travel;
}

bool HybridRitoNitro::paperTurnLands(const std::vector<double>& release) {
  requireLength(release, RITO_PAPER_TURN_RELEASE_NUMBERS, "A paper turn release");
  std::uint32_t lands = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_lands(release.data(), &lands, &error), &error, "paperTurnLands");
  return lands != 0;
}

double HybridRitoNitro::paperTurnEyeHeight(double width, double height) {
  double eye = 0;
  rito_owned_buffer error{};
  requireOk(rito_paper_turn_eye_height(width, height, &eye, &error), &error, "paperTurnEyeHeight");
  return eye;
}

std::shared_ptr<Promise<RitoNitroResult>> HybridRitoNitro::disposeSession(const std::string& sessionId) {
  return submitChecked(executor_, [session = parseExternalId(sessionId, "sessionId")] {
    rito_owned_buffer output{}; rito_owned_buffer error{};
    const auto status = rito_dispose(session, &error);
    return ritojs::reactnative::collectRitoResult(status, &output, &error);
  });
}

}  // namespace margelo::nitro::ritonitro
