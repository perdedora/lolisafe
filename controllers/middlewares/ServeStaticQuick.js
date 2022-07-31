/*
 * ServeStaticQuick.
 *
 * This is intended as a compromise between ServeStatic handler and
 * ServeLiveDirectory middleware.
 *
 * This monitors and caches the configured directory's file tree for quick lookups,
 * thus allowing multiple instances of this middleware to be used together, if needed.
 *
 * When matches are found, it will then simply spawn ReadStream to the physical files.
 * Due to the fact that it does not have to pre-cache the whole files into memory,
 * this is likely the better choice to serve generic assets
 * in an environment where memory space is a premium.
 *
 * This class also has Conditional GETs support,
 * which involves handling cache-related headers such as
 * If-Match, If-Unmodified-Since, ETag, etc.
 * And partial bytes fetch by handling Content-Range header,
 * which is useful for streaming, among other things.
 */

const chokidar = require('chokidar')
const etag = require('etag')
const fs = require('fs')
const parseRange = require('range-parser')
const serveUtils = require('./../utils/serveUtils')
const logger = require('./../../logger')

class ServeStaticQuick {
  directory
  files
  watcher

  #options
  #readyPromise
  #readyResolve

  constructor (directory, options = {}) {
    if (!directory || typeof directory !== 'string') {
      throw new TypeError('Root directory must be set')
    }

    this.directory = serveUtils.forwardSlashes(directory)

    // Ensure does not end with a forward slash
    if (this.directory.endsWith('/')) {
      this.directory = this.directory.slice(0, -1)
    }

    if (options.acceptRanges === undefined) {
      options.acceptRanges = true
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

    this.files = new Map()

    this.watcher = chokidar.watch(this.directory, {
      alwaysStat: true,
      awaitWriteFinish: {
        pollInterval: 100,
        stabilityThreshold: 500
      }
    })

    this.#bindWatchHandlers()

    this.#options = options
  }

  /*
   * Based on https://github.com/pillarjs/send/blob/0.18.0/index.js
   * Copyright(c) 2012 TJ Holowaychuk
   * Copyright(c) 2014-2022 Douglas Christopher Wilson
   * MIT Licensed
   */

  handler (req, res, stat) {
    // ReadStream options
    let len = stat.size
    const opts = {}
    let ranges = req.headers.range
    let offset = 0

    // set content-type
    res.type(req.path)

    // set header fields
    this.#setHeaders(req, res, stat)

    // conditional GET support
    if (serveUtils.isConditionalGET(req)) {
      if (serveUtils.isPreconditionFailure(req, res)) {
        return res.status(412).end()
      }

      if (serveUtils.isFresh(req, res)) {
        return res.status(304).end()
      }
    }

    // adjust len to start/end options
    len = Math.max(0, len - offset)
    if (opts.end !== undefined) {
      const bytes = opts.end - offset + 1
      if (len > bytes) len = bytes
    }

    // Range support
    if (this.#options.acceptRanges && serveUtils.BYTES_RANGE_REGEXP.test(ranges)) {
      // parse
      ranges = parseRange(len, ranges, {
        combine: true
      })

      // If-Range support
      if (!serveUtils.isRangeFresh(req, res)) {
        // range stale
        ranges = -2
      }

      // unsatisfiable
      if (ranges === -1) {
        // Content-Range
        res.header('Content-Range', serveUtils.contentRange('bytes', len))

        // 416 Requested Range Not Satisfiable
        return res.status(416).end()
      }

      // valid (syntactically invalid/multiple ranges are treated as a regular response)
      if (ranges !== -2 && ranges.length === 1) {
        // Content-Range
        res.status(206)
        res.header('Content-Range', serveUtils.contentRange('bytes', len, ranges[0]))

        // adjust for requested range
        offset += ranges[0].start
        len = ranges[0].end - ranges[0].start + 1
      }
    }

    // set read options
    opts.start = offset
    opts.end = Math.max(offset, offset + len - 1)

    // HEAD support
    if (req.method === 'HEAD') {
      // If HEAD, also set Content-Length (must be string)
      res.header('Content-Length', String(len))
      return res.end()
    }

    if (len === 0) {
      res.end()
    }

    return this.#stream(req, res, stat, opts, len)
  }

  // Returns a promise which resolves to true once ServeStaticQuick is ready
  ready () {
    // Resolve with true if ready is not a promise
    if (this.#readyPromise === true) return Promise.resolve(true)

    // Create a promise if one does not exist for ready event
    if (this.#readyPromise === undefined) { this.#readyPromise = new Promise((resolve) => (this.#readyResolve = resolve)) }

    return this.#readyPromise
  }

  #bindWatchHandlers () {
    this.watcher.on('all', (event, path, stat) => {
      const relPath = serveUtils.relativePath(this.directory, path)

      if (!relPath) return // skips root directory

      switch (event) {
        case 'add':
        case 'addDir':
        case 'change':
          this.files.set(relPath, stat)
          break
        case 'unlink':
        case 'unlinkDir':
          this.files.delete(relPath)
          break
      }
    })

    // Bind 'ready' for when all files have been loaded
    this.watcher.once('ready', () => {
      // Resolve pending promise if one exists
      if (typeof this.#readyResolve === 'function') {
        this.#readyResolve()
        this.#readyResolve = null
      }

      // Mark instance as ready
      this.#readyPromise = true
    })
  }

  #get (path) {
    const stat = this.files.get(path)

    if (!stat || stat.isDirectory()) return

    return stat
  }

  #middleware (req, res, next) {
    // Only process GET and HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next()
    }

    const stat = this.#get(req.path)
    if (stat === undefined) {
      return next()
    }

    return this.handler(req, res, stat)
  }

  #setHeaders (req, res, stat) {
    // Always do external setHeaders function first,
    // in case it will overwrite the following default headers anyways
    if (this.#options.setHeaders) {
      this.#options.setHeaders(req, res)
    }

    if (this.#options.acceptRanges && !res.get('Accept-Ranges')) {
      res.header('Accept-Ranges', 'bytes')
    }

    if (this.#options.lastModified && !res.get('Last-Modified')) {
      const modified = stat.mtime.toUTCString()
      res.header('Last-Modified', modified)
    }

    if (this.#options.etag && !res.get('ETag')) {
      const val = etag(stat)
      res.header('ETag', val)
    }
  }

  #stream (req, res, stat, opts, len) {
    const fullPath = this.directory + req.path
    const readStream = fs.createReadStream(fullPath, opts)

    readStream.on('error', error => {
      readStream.destroy()
      logger.error(error)
    })

    // 2nd param will be set as Content-Length header (must be number)
    return res.stream(readStream, len)
  }

  get middleware () {
    return this.#middleware.bind(this)
  }
}

module.exports = ServeStaticQuick
