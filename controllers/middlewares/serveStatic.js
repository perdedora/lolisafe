
const contentDisposition = require('content-disposition')
const SimpleDataStore = require('../utils/SimpleDataStore')
const paths = require('../pathsController')
const utils = require('../utilsController')
const logger = require('../../logger')

class ServeStatic {
  directory
  contentDispositionStore
  contentTypesMaps

  async #setContentDisposition () {}
  #setContentType () {}

  constructor (directory, options = {}) {
    logger.error('new ServeStatic()')
    if (!directory || typeof directory !== 'string') {
      throw new TypeError('Root directory must be set')
    }

    this.directory = directory

    // Init Content-Type overrides
    if (typeof options.overrideContentTypes === 'object') {
      this.contentTypesMaps = new Map()

      const types = Object.keys(options.overrideContentTypes)
      for (const type of types) {
        const extensions = options.overrideContentTypes[type]
        if (Array.isArray(extensions)) {
          for (const extension of extensions) {
            this.contentTypesMaps.set(extension, type)
          }
        }
      }

      if (this.contentTypesMaps.size) {
        this.#setContentType = (res, path, stat) => {
          // Do only if accessing files from uploads' root directory (i.e. not thumbs, etc.)
          const relpath = path.replace(paths.uploads, '')
          if (relpath.indexOf('/', 1) === -1) {
            const name = relpath.substring(1)
            const extname = utils.extname(name).substring(1)
            const contentType = this.contentTypesMaps.get(extname)
            if (contentType) {
              res.set('Content-Type', contentType)
            }
          }
        }
      } else {
        this.contentTypesMaps = undefined
      }
    }

    // Init Content-Disposition store and setHeaders function if required
    if (options.setContentDisposition) {
      this.contentDispositionStore = new SimpleDataStore(
        options.contentDispositionOptions || {
          limit: 50,
          strategy: SimpleDataStore.STRATEGIES[0]
        }
      )

      this.#setContentDisposition = async (res, path, stat) => {
        // Do only if accessing files from uploads' root directory (i.e. not thumbs, etc.)
        const relpath = path.replace(paths.uploads, '')
        if (relpath.indexOf('/', 1) !== -1) return
        const name = relpath.substring(1)
        try {
          let original = this.contentDispositionStore.get(name)
          if (original === undefined) {
            this.contentDispositionStore.hold(name)
            original = await utils.db.table('files')
              .where('name', name)
              .select('original')
              .first()
              .then(_file => {
                this.contentDispositionStore.set(name, _file.original)
                return _file.original
              })
          }
          if (original) {
            res.set('Content-Disposition', contentDisposition(original, { type: 'inline' }))
          }
        } catch (error) {
          this.contentDispositionStore.delete(name)
          logger.error(error)
        }
      }

      logger.debug('Inititated SimpleDataStore for Content-Disposition: ' +
         `{ limit: ${this.contentDispositionStore.limit}, strategy: "${this.contentDispositionStore.strategy}" }`)
    }
  }

  async #setHeaders (req, res) {
    logger.log('ServeStatic.setHeaders()')

    this.#setContentType(req, res)

    // Only set Content-Disposition on GET requests
    if (req.method === 'GET') {
      await this.#setContentDisposition(req, res)
    }
  }

  async #middleware (req, res, next) {
    logger.log(`ServeStatic.middleware(): ${this.directory}, ${req.path}`)

    // TODO

    return next()
  }

  get middleware () {
    return this.#middleware.bind(this)
  }
}

module.exports = ServeStatic
