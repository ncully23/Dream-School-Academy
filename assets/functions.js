/**
 * functions.js
 * Utility functions for Dream School Academy site
 * -------------------------------------------------
 * Usage:
 *   resizeImage("#myImageId", 30); // sets width to 30%
 *   resizeImage(".className", 50); // sets width to 50%
 */

/**
 * Resize a specific image by percentage width
 * @param {string} selector - CSS selector for the image (e.g. "#triangle-angles" or ".concept img")
 * @param {number} percent - Desired width percentage (e.g. 30 for 30%)
 */
function resizeImage(selector, percent) {
  const img = document.querySelector(selector);
  if (!img) {
    console.warn("resizeImage: No image found for selector:", selector);
    return;
  }
  img.style.width = percent + "%";
  img.style.height = "auto";
}

/**
 * Resize all matching images by percentage width
 * @param {string} selector - CSS selector for multiple images (e.g. ".concept img")
 * @param {number} percent - Desired width percentage
 */
function resizeAllImages(selector, percent) {
  const images = document.querySelectorAll(selector);
  if (images.length === 0) {
    console.warn("resizeAllImages: No images found for selector:", selector);
    return;
  }
  images.forEach(img => {
    img.style.width = percent + "%";
    img.style.height = "auto";
  });
}

// Export functions to global scope
window.resizeImage = resizeImage;
window.resizeAllImages = resizeAllImages;
