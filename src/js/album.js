/* global LazyLoad, SimpleLightbox */

// eslint-disable-next-line no-unused-vars
const lsKeys = {}

const page = {
  lazyLoad: null,
  lightbox: null,

  // Array of extensions that will be whitelisted for SimpleLightbox
  // Should only include image extensions that can be rendered directly on browsers
  lightboxExts: ['.gif', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp', '.bmp'],

  updateImageContainer: element => {
    // Update size & string elements within each individual image container
    const container = element.parentNode.parentNode
    if (!container.classList.contains('image-container')) return

    const sizeElement = container.querySelector('.file-size')
    if (sizeElement) {
      const string = sizeElement.dataset.value || sizeElement.innerHTML
      sizeElement.innerHTML = page.getPrettyBytes(parseInt(string, 10))
    }

    const dateElement = document.querySelector('.file-date')
    if (dateElement) {
      const string = dateElement.dataset.value
      dateElement.innerHTML = page.getPrettyDate(new Date(parseInt(string, 10) * 1000))
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // Update size string in album header block
  const headerSize = document.querySelector('#count .file-size')
  if (headerSize) {
    const string = headerSize.dataset.value || headerSize.innerHTML
    headerSize.innerHTML = page.getPrettyBytes(parseInt(string, 10))
  }

  // Attach callback function to lazyloader
  page.lazyLoad = new LazyLoad({
    unobserve_entered: true,
    callback_enter: page.updateImageContainer
  })

  // Build RegExp out of imageExts array
  // SimpleLightbox demands RegExp for configuring supported file extensions
  const imageExtsRegex = new RegExp(`${page.lightboxExts.map(ext => {
    return ext.substring(1) // removes starting dot
  }).join('|')}`, 'i')

  page.lightbox = new SimpleLightbox('#table a.image', {
    captions: true,
    captionSelector: 'img',
    captionType: 'attr',
    captionsData: 'alt',
    captionPosition: 'bottom',
    captionDelay: 500,
    fileExt: imageExtsRegex,
    preloading: false,
    uniqueImages: false
  })
})
