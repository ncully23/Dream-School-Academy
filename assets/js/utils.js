/**
 * Resize images by ID, class, or exact src match.
 * @param {string} selectorOrSrc - CSS selector (#id, .class) or an image src starting with "/".
 * @param {number} percent - Width percentage to set (e.g., 30 for 30%).
 */
export function resizeImage(selectorOrSrc, percent) {
  const p = Math.max(1, Math.min(100, Number(percent) || 100)); // clamp
  let images;

  if (selectorOrSrc.startsWith("/")) {
    images = Array.from(document.querySelectorAll(`img[src="${selectorOrSrc}"]`));
  } else {
    images = Array.from(document.querySelectorAll(selectorOrSrc));
  }

  if (images.length === 0) {
    console.warn("No images found for:", selectorOrSrc);
    return;
  }

  images.forEach(img => {
    img.style.width = p + "%";
    img.style.height = "auto";
    img.loading = img.loading || "lazy";
    img.decoding = img.decoding || "async";
  });
}

/* 
  If you don't want to use ESM imports everywhere, you can also attach to window:
  window.resizeImage = resizeImage;
*/
