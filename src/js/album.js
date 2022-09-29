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
  const files = document.querySelectorAll('.image-container')

  // Prettify individual file's data rows
  for (let i = 0; i < files.length; i++) {
    const sizeElem = files[i].querySelector('.details .file-size')
    if (sizeElem) {
      const str = sizeElem.dataset.value || sizeElem.innerHTML.replace(/\s*B$/i, '')
      sizeElem.innerHTML = page.getPrettyBytes(parseInt(str))
    }

    const dateElem = files[i].querySelector('.details .file-date')
    if (dateElem) {
      const str = dateElem.dataset.value
      dateElem.innerHTML = page.getPrettyDate(new Date(parseInt(str) * 1000))
    }
  }

  page.lazyLoad = new LazyLoad()

  // Build RegExp out of imageExts array
  // SimpleLightbox demands RegExp for configuring supported file extensions
  const imageExtsRegex = new RegExp(`${page.lightboxExts.map(ext => {
    return ext.substring(1) // removes starting dot
  }).join('|')}`, 'i')

  console.log(imageExtsRegex)
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
