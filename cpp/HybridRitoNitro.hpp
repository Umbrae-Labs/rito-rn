#pragma once

#include "HybridRitoNitroSpec.hpp"
#include "RitoExecutor.h"

namespace margelo::nitro::ritonitro {

class HybridRitoNitro final : public HybridRitoNitroSpec {
 public:
  HybridRitoNitro();
  ~HybridRitoNitro() override;

  std::shared_ptr<Promise<RitoNitroResult>> open(const std::shared_ptr<ArrayBuffer>& publication, const std::shared_ptr<ArrayBuffer>& request, const std::vector<RitoNitroPinnedFontFace>& fonts) override;
  std::shared_ptr<Promise<RitoNitroResult>> readPublication(const std::string& sessionId) override;
  std::shared_ptr<Promise<RitoNitroResult>> requestArtifact(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> requestAdjacent(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> peekAdjacent(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> adoptForeground(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> commitPeekedArtifact(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> advanceBackground(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> adoptBackground(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> readResource(const std::string& sessionId, const std::string& artifactId, double kind, const std::string& href) override;
  std::shared_ptr<Promise<RitoNitroResult>> search(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> textRangeGeometry(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> resolveExactSourceRange(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> readPage(const std::string& sessionId, const std::string& artifactId, double pageIndex) override;
  std::shared_ptr<Promise<RitoNitroResult>> readFootnote(const std::string& sessionId, const std::string& artifactId, const std::string& key) override;
  std::shared_ptr<Promise<RitoNitroResult>> releaseArtifact(const std::string& sessionId, const std::string& artifactId) override;
  std::shared_ptr<Promise<RitoNitroResult>> disposeSession(const std::string& sessionId) override;

  std::shared_ptr<Promise<RitoNitroResult>> openWithoutPinnedFonts(const std::shared_ptr<ArrayBuffer>& publication, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> openShards(const std::shared_ptr<ArrayBuffer>& skeleton, const std::shared_ptr<ArrayBuffer>& key, const std::shared_ptr<ArrayBuffer>& request, const std::vector<RitoNitroPinnedFontFace>& fonts) override;
  std::shared_ptr<Promise<RitoNitroResult>> supplyShard(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& shard, const std::shared_ptr<ArrayBuffer>& key) override;
  std::shared_ptr<Promise<RitoNitroResult>> contentShardsNear(const std::string& sessionId, const std::string& href) override;
  std::shared_ptr<Promise<RitoNitroResult>> peekSpread(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> resolveTextInteraction(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> resolveAnnotation(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> resolveNavigation(const std::string& sessionId, const std::shared_ptr<ArrayBuffer>& request) override;
  std::shared_ptr<Promise<RitoNitroResult>> fontCatalog(const std::string& sessionId) override;
  std::shared_ptr<Promise<RitoNitroResult>> unresolvedFontFamilies(const std::string& sessionId, const std::string& list) override;
  std::shared_ptr<Promise<RitoNitroResult>> addHostFontFaces(const std::string& sessionId, const std::vector<RitoNitroPinnedFontFace>& fonts) override;
  std::shared_ptr<Promise<RitoNitroResult>> removeHostFontFaces(const std::string& sessionId, const std::vector<std::string>& sha256) override;
  std::shared_ptr<Promise<RitoNitroResult>> markFontFamilyUnavailable(const std::string& sessionId, const std::string& family) override;

  std::vector<double> paperTurnLayouts() override;
  std::string paperTurnNew() override;
  void paperTurnFree(const std::string& turn) override;
  RitoNitroPaperTurnLeaves paperTurnBegin(const std::string& turn, const std::vector<double>& frame, double leavesCapacity) override;
  RitoNitroPaperTurnLeaves paperTurnLay(const std::string& turn, double epoch, double leavesCapacity) override;
  RitoNitroPaperTurnSheet paperTurnSheet(const std::string& turn, double index, double pointsCapacity) override;
  RitoNitroPaperTurnForgotten paperTurnForget(const std::string& turn, double epoch, double leavesCapacity) override;
  std::vector<double> paperTurnState(const std::string& turn, double now) override;
  std::vector<double> paperTurnBegins(const std::string& turn, double dx, double velocity, bool sameSpreads) override;
  std::vector<double> paperTurnSettle(const std::string& turn, double from, double velocity, double to) override;
  RitoNitroPaperTurnSettleStep paperTurnSettleStep(const std::string& turn, const std::vector<double>& settle, double seconds, double now) override;
  double paperTurnTravel(const std::vector<double>& touch, double width, double spine) override;
  bool paperTurnLands(const std::vector<double>& release) override;
  double paperTurnEyeHeight(double width, double height) override;

 private:
  ritojs::reactnative::RitoExecutor executor_;
};

}  // namespace margelo::nitro::ritonitro
