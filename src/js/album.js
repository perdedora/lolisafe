/* global LazyLoad, SimpleLightbox */

// eslint-disable-next-line no-unused-vars
const lsKeys = {}

const page = {
  lazyLoad: null,
  lightbox: null,

  // Array of extensions that will be whitelisted for SimpleLightbox
  // Should only include image extensions that can be rendered directly on browsers
  lightboxExts: ['.gif', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp', '.bmp']
}

window.addEventListener('DOMContentLoaded', () => {
  // Prettify all .file-size elements
  const sizeElements = document.querySelectorAll('.file-size')
  for (let i = 0; i < sizeElements.length; i++) {
    const string = sizeElements[i].dataset.value || sizeElements[i].innerHTML
    sizeElements[i].innerHTML = page.getPrettyBytes(parseInt(string, 10))
  }

  // Prettify all .file-date elements
  const dateElements = document.querySelectorAll('.file-date')
  for (let i = 0; i < dateElements.length; i++) {
    const string = dateElements[i].dataset.value
    dateElements[i].innerHTML = page.getPrettyDate(new Date(parseInt(string, 10) * 1000))
  }

  page.lazyLoad = new LazyLoad()

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
