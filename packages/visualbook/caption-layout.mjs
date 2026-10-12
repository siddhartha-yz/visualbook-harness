// A narrow mechanical caption check, not a semantic or artistic evaluator.
function definitelyStacks(scene, maximumWidth) {
  if (!scene || typeof scene !== 'object') return false;
  if (scene.type === 'columns' && Array.isArray(scene.children) && scene.children.length > 1) {
    const layout = scene.layout ?? {}, n = scene.children.length;
    if ((maximumWidth - (layout.gap ?? 18) * (n - 1)) / n < (layout.minColumnWidth ?? 260)) return true;
  }
  return definitelyStacks(scene.visual, maximumWidth) || (scene.children ?? []).some(child => definitelyStacks(child, maximumWidth));
}
export function captionLayoutFindings(figure, maximumMobileWidth = 375) {
  const text = figure.summary;
  if (typeof text !== 'string' || !definitelyStacks(figure.scene, maximumMobileWidth)) return [];
  const positionPair = /(?:在左|左图|左侧图|左栏).*(?:在右|右图|右侧图|右栏)|(?:在右|右图|右侧图|右栏).*(?:在左|左图|左侧图|左栏)|\b(?:on the left|left panel)\b.*\b(?:on the right|right panel)\b/i;
  // Signed axes are not panel-layout descriptions. This intentionally remains
  // narrow; custom code and other spatial phrases need actual picture review.
  if (!positionPair.test(text) || /零线|零点|负值|正值|数轴|横轴|\b(?:negative|positive|zero|axis)\b/i.test(text)) return [];
  return [{kind:'responsive-positional-caption', figureId:figure.id, maximumMobileWidth,
    message:'These columns stack on mobile. Refer to visible panel titles or coordinate labels instead of left/right in the shared caption.'}];
}
