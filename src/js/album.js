/* global LazyLoad */

// eslint-disable-next-line no-unused-vars
const lsKeys = {}

const page = {
  lazyLoad: null
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
})
