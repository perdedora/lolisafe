/*
 * ServeLiveDirectory is a middleware wrapper for LiveDirectory library.
 *
 * It is mainly intended to add Conditional GETs support,
 * which involves handling cache-related headers such as
 * If-Match, If-Unmodified-Since, ETag, etc.
 *
 * LiveDirectory monitors and caches all the files in the configure directory into memory,
 * which allows very fast lookups, thus allowing multiple instances of this middleware
 * to be used together, if needed.
 *
 * However, due to the fact that it caches all the files into memory,
 * this may not be the best choice in an environment where memory space is a premium.
 */

const LiveDirectory = require('live-directory')
const serveUtils = require('./../utils/serveUtils')

class ServeLiveDirectory {
  instance

  #options

  constructor (directory, options = {}) {
    if (!directory || typeof directory !== 'string') {
      throw new TypeError('Root directory must be set')
    }

    this.directory = serveUtils.forwardSlashes(directory)

    // Ensure does not end with a forward slash
    if (this.directory.endsWith('/')) {
      this.directory = this.directory.slice(0, -1)
    }

    if (options.etag === undefined) {
      options.etag = true
    }

    if (options.lastModified === undefined) {
      options.lastModified = true
    }

    if (options.setHeaders && typeof options.setHeaders !== 'function') {
      throw new TypeError('Middleware option setHeaders must be a function')
    }

    const instanceOptions = Object.assign({}, options.instanceOptions)
    instanceOptions.path = this.directory

    delete options.instanceOptions

    if (!instanceOptions.ignore) {
      instanceOptions.ignore = path => {
        // ignore dot files
        return path.startsWith('.')
      }
    }

    this.instance = new LiveDirectory(instanceOptions)

    this.#options = options
  }

  /*
   * Based on https://github.com/pillarjs/send/blob/0.18.0/index.js
   * Copyright(c) 2012 TJ Holowaychuk
   * Copyright(c) 2014-2022 Douglas Christopher Wilson
   * MIT Licensed
   */

  handler (req, res, file) {
    // set content-type
    res.type(file.extension)

    // set header fields
    this.#setHeaders(req, res, file)

    // conditional GET support
    if (serveUtils.isConditionalGET(req)) {
      if (serveUtils.isPreconditionFailure(req, res)) {
        return res.status(412).end()
      }

      if (serveUtils.isFresh(req, res)) {
        return res.status(304).end()
      }
    }

    // HEAD support
    if (req.method === 'HEAD') {
      return res.end()
    }

    return res.send(file.buffer)
  }

  #middleware (req, res, next) {
    // Only process GET and HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next()
    }

    const file = this.instance.get(req.path)
    if (file === undefined) {
      return next()
    }

    return this.handler(req, res, file)
  }

  #setHeaders (req, res, file) {
    // Always do external setHeaders function first,
    // in case it will overwrite the following default headers anyways
    if (this.#options.setHeaders) {
      this.#options.setHeaders(req, res)
    }

    if (this.#options.lastModified && !res.get('Last-Modified')) {
      const modified = new Date(file.last_update).toUTCString()
      res.header('Last-Modified', modified)
    }

    if (this.#options.etag && !res.get('ETag')) {
      const val = file.etag
      res.header('ETag', val)
    }
  }

  get middleware () {
    return this.#middleware.bind(this)
  }
}

module.exports = ServeLiveDirectory
