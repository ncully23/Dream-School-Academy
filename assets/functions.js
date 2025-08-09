/**
 * Resize images by ID, class, or exact src match.
 * @param {string} selectorOrSrc - Can be a CSS selector (#id, .class) or an image src string.
 * @param {number} percent - The width percentage to set (e.g., 30 for 30%).
 */
function resizeImage(selectorOrSrc, percent) {
  let images;

  // If it's a path starting with "/", assume it's a src
  if (selectorOrSrc.startsWith("/")) {
    images = Array.from(document.querySelectorAll(`img[src="${selectorOrSrc}"]`));
  } else {
    // Otherwise treat it as a CSS selector
    images = Array.from(document.querySelectorAll(selectorOrSrc));
  }

  if (images.length === 0) {
    console.warn("No images found for:", selectorOrSrc);
    return;
  }

  images.forEach(img => {
    img.style.width = percent + "%";
    img.style.height = "auto";
  });
}
