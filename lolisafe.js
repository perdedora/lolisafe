const logger = require('./logger')

// Stray errors and exceptions capturers
process.on('uncaughtException', error => {
  logger.error(error, { prefix: 'Uncaught Exception: ' })
})

process.on('unhandledRejection', error => {
  logger.error(error, { prefix: 'Unhandled Rejection (Promise): ' })
})

// Libraries
const contentDisposition = require('content-disposition')
const helmet = require('helmet')
const HyperExpress = require('hyper-express')
const LiveDirectory = require('live-directory')
const NodeClam = require('clamscan')
// const rateLimit = require('express-rate-limit') // FIXME: Find alternative
const { accessSync, constants } = require('fs')

// Check required config files
const configFiles = ['config.js', 'views/_globals.njk']
for (const _file of configFiles) {
  try {
    accessSync(_file, constants.R_OK)
  } catch (error) {
    logger.error(`Config file '${_file}' cannot be found or read.`)
    logger.error('Please copy the provided sample file and modify it according to your needs.')
    process.exit(1)
  }
}

// Config files
const config = require('./config')
const versions = require('./src/versions')

// lolisafe
logger.log('Starting lolisafe\u2026')
const safe = new HyperExpress.Server({
  trust_proxy: Boolean(config.trustProxy)
})

const errors = require('./controllers/errorsController')
const paths = require('./controllers/pathsController')
paths.initSync()
const utils = require('./controllers/utilsController')

// Custom middlewares
const NunjucksRenderer = require('./controllers/middlewares/nunjucksRenderer')
// const ServeStatic = require('./controllers/middlewares/serveStatic') // TODO

// Routes
const album = require('./routes/album')
const api = require('./routes/api')
const file = require('./routes/file')
const nojs = require('./routes/nojs')
const player = require('./routes/player')

const isDevMode = process.env.NODE_ENV === 'development'

// Helmet security headers
if (config.helmet instanceof Object) {
  // If an empty object, simply do not use Helmet
  if (Object.keys(config.helmet).length) {
    safe.use(helmet(config.helmet))
  }
} else {
  // Fallback to old behavior when the whole helmet option was not configurable from the config file
  const defaults = {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    hsts: false,
    originAgentCluster: false
  }

  if (config.hsts instanceof Object && Object.keys(config.hsts).length) {
    defaults.hsts = config.hsts
  }

  safe.use(helmet(defaults))
}

// Access-Control-Allow-Origin
if (config.accessControlAllowOrigin) {
  if (config.accessControlAllowOrigin === true) {
    config.accessControlAllowOrigin = '*'
  }
  safe.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', config.accessControlAllowOrigin)
    if (config.accessControlAllowOrigin !== '*') {
      res.vary('Origin')
    }
    next()
  })
}

// NunjucksRenderer middleware
const nunjucksRendererInstance = new NunjucksRenderer('views', {
  watch: isDevMode
})
safe.use('/', nunjucksRendererInstance.middleware)

const initLiveDirectory = (options = {}) => {
  if (!options.ignore) {
    options.ignore = path => {
      // ignore dot files
      return path.startsWith('.')
    }
  }
  return new LiveDirectory(options)
}

// Configure rate limits (disabled during development)
// FIXME: express-rate-limit does not work with hyper-express, find alternative
/*
if (!isDevMode && Array.isArray(config.rateLimits) && config.rateLimits.length) {
  for (const _rateLimit of config.rateLimits) {
    const limiter = rateLimit(_rateLimit.config)
    for (const route of _rateLimit.routes) {
      safe.use(route, limiter)
    }
  }
}
*/

const cdnPages = [...config.pages]

// Defaults to no-op
let setHeadersForStaticAssets = () => {}

const contentTypes = typeof config.overrideContentTypes === 'object' &&
  Object.keys(config.overrideContentTypes)
const overrideContentTypes = contentTypes && contentTypes.length && function (res, path) {
  // Do only if accessing files from uploads' root directory (i.e. not thumbs, etc.)
  const relpath = path.replace(paths.uploads, '')
  if (relpath.indexOf('/', 1) === -1) {
    const name = relpath.substring(1)
    const extname = utils.extname(name).substring(1)
    for (const contentType of contentTypes) {
      if (config.overrideContentTypes[contentType].includes(extname)) {
        res.set('Content-Type', contentType)
        break
      }
    }
  }
}

const initServeStaticUploads = (opts = {}) => {
  if (config.setContentDisposition) {
    const SimpleDataStore = require('./controllers/utils/SimpleDataStore')
    utils.contentDispositionStore = new SimpleDataStore(
      config.contentDispositionOptions || {
        limit: 50,
        strategy: SimpleDataStore.STRATEGIES[0]
      }
    )
    opts.preSetHeaders = async (res, req, path, stat) => {
      // Do only if accessing files from uploads' root directory (i.e. not thumbs, etc.),
      // AND only if GET requests
      const relpath = path.replace(paths.uploads, '')
      if (relpath.indexOf('/', 1) !== -1 || req.method !== 'GET') return
      const name = relpath.substring(1)
      try {
        let original = utils.contentDispositionStore.get(name)
        if (original === undefined) {
          utils.contentDispositionStore.hold(name)
          original = await utils.db.table('files')
            .where('name', name)
            .select('original')
            .first()
            .then(_file => {
              utils.contentDispositionStore.set(name, _file.original)
              return _file.original
            })
        }
        if (original) {
          res.set('Content-Disposition', contentDisposition(original, { type: 'inline' }))
        }
      } catch (error) {
        utils.contentDispositionStore.delete(name)
        logger.error(error)
      }
    }
    // serveStatic is provided with @bobbywibowo/serve-static, a fork of express/serve-static.
    // The fork allows specifying an async function by the name preSetHeaders,
    // which it will await before creating 'send' stream to client.
    // This is necessary due to database queries being async tasks,
    // and express/serve-static not having the functionality by default.
    // safe.use('/', require('@bobbywibowo/serve-static')(paths.uploads, opts))
    // logger.debug('Inititated SimpleDataStore for Content-Disposition: ' +
    //   `{ limit: ${utils.contentDispositionStore.limit}, strategy: "${utils.contentDispositionStore.strategy}" }`)
    logger.error('initServeStaticUploads() was called, but still WIP')
  } else {
    // safe.use('/', express.static(paths.uploads, opts))
    logger.error('initServeStaticUploads() was called, but still WIP')
  }
}

// Cache control
if (config.cacheControl) {
  const cacheControls = {
    // max-age: 6 months
    static: 'public, max-age=15778800, immutable',
    // s-max-age: 6 months (only cache in CDN)
    cdn: 's-max-age=15778800, proxy-revalidate',
    // validate cache's validity before using them (soft cache)
    validate: 'no-cache',
    // do not use cache at all
    disable: 'no-store'
  }

  // By default soft cache everything
  safe.use('/', (req, res, next) => {
    // FIXME: Routes further down the line that may set  their own Cache-Control headers,
    // will end up with multiple headers
    res.set('Cache-Control', cacheControls.validate)
    return next()
  })

  switch (config.cacheControl) {
    case 1:
    case true:
      // If using CDN, cache public pages in CDN
      cdnPages.push('api/check')
      for (const page of cdnPages) {
        safe.get(`/${page === 'home' ? '' : page}`, async (req, res) => {
          res.set('Cache-Control', cacheControls.cdn)
        })
      }
      break
  }

  // If serving uploads with node
  if (config.serveFilesWithNode) {
    initServeStaticUploads({
      setHeaders: (res, path) => {
        // Override Content-Type header if necessary
        if (overrideContentTypes) {
          overrideContentTypes(res, path)
        }
        // If using CDN, cache uploads in CDN as well
        // Use with cloudflare.purgeCache enabled in config file
        if (config.cacheControl !== 2) {
          res.set('Cache-Control', cacheControls.cdn)
        }
      }
    })
  }

  // Function for static assets.
  // This requires the assets to use version in their query string,
  // as they will be cached by clients for a very long time.
  setHeadersForStaticAssets = (req, res) => {
    res.set('Cache-Control', cacheControls.static)
  }

  // Consider album ZIPs static as well, since they use version in their query string
  safe.use('/api/album/zip', (req, res, next) => {
    const versionString = parseInt(req.query.v)
    if (versionString > 0) {
      res.set('Cache-Control', cacheControls.static)
    } else {
      res.set('Cache-Control', cacheControls.disable)
    }
    return next()
  })
} else if (config.serveFilesWithNode) {
  const opts = {}
  // Override Content-Type header if necessary
  if (overrideContentTypes) {
    opts.setHeaders = overrideContentTypes
  }
  initServeStaticUploads(opts)
}

// Static assets
const liveDirectoryPublic = initLiveDirectory({ path: paths.public })
const liveDirectoryDist = initLiveDirectory({ path: paths.dist })
safe.use('/', (req, res, next) => {
  // Only process GET and HEAD requests
  if (req.method === 'GET' || req.method === 'HEAD') {
    // Try to find asset from public directory, then dist directory
    const file =
      liveDirectoryPublic.get(req.path) ||
      liveDirectoryDist.get(req.path)
    if (file === undefined) {
      return next()
    }
    setHeadersForStaticAssets(req, res)
    return res.type(file.extension).send(file.buffer)
  }
  return next()
})

// Routes
safe.use('/', album)
safe.use('/', file)
safe.use('/', nojs)
safe.use('/', player)
safe.use('/api', api)

;(async () => {
  try {
    // Init database
    await require('./controllers/utils/initDatabase')(utils.db)

    // Purge any leftover in chunks directory, do not wait
    paths.purgeChunks()

    if (!Array.isArray(config.pages) || !config.pages.length) {
      logger.error('Config file does not have any frontend pages enabled')
      process.exit(1)
    }

    // Re-map version strings if cache control is enabled (safe.fiery.me)
    utils.versionStrings = {}
    if (config.cacheControl) {
      for (const type in versions) {
        utils.versionStrings[type] = `?_=${versions[type]}`
      }
      if (versions['1']) {
        utils.clientVersion = versions['1']
      }
    }

    const liveDirectoryCustomPages = initLiveDirectory({
      path: paths.customPages,
      keep: ['.html']
    })

    // Cookie Policy
    if (config.cookiePolicy) {
      config.pages.push('cookiepolicy')
    }

    // Check for custom pages, otherwise fallback to Nunjucks templates
    for (const page of config.pages) {
      // FIXME: Have this update on-the-fly or don't use LiveDirectory
      const customPage = liveDirectoryCustomPages.get(`${page}.html`)
      if (customPage) {
        safe.get(`/${page === 'home' ? '' : page}`, (req, res) => {
          res.type('html').send(customPage.buffer)
        })
      } else if (page === 'home') {
        safe.get('/', (req, res) => res.render(page, {
          config, utils, versions: utils.versionStrings
        }))
      } else {
        safe.get(`/${page}`, (req, res) => res.render(page, {
          config, utils, versions: utils.versionStrings
        }))
      }
    }

    // Web server error handlers (must always be set after all routes/middlewares)
    safe.set_not_found_handler(errors.handleNotFound)
    safe.set_error_handler(errors.handleError)

    // Git hash
    if (config.showGitHash) {
      utils.gitHash = await new Promise((resolve, reject) => {
        require('child_process').exec('git rev-parse HEAD', (error, stdout) => {
          if (error) return reject(error)
          resolve(stdout.replace(/\n$/, ''))
        })
      })
      logger.log(`Git commit: ${utils.gitHash}`)
    }

    // ClamAV scanner
    if (config.uploads.scan && config.uploads.scan.enabled) {
      if (!config.uploads.scan.clamOptions) {
        logger.error('Missing object config.uploads.scan.clamOptions (check config.sample.js)')
        process.exit(1)
      }
      utils.scan.instance = await new NodeClam().init(config.uploads.scan.clamOptions)
      utils.scan.version = await utils.scan.instance.getVersion().then(s => s.trim())
      logger.log(`Connection established with ${utils.scan.version}`)
    }

    // Cache file identifiers
    if (config.uploads.cacheFileIdentifiers) {
      utils.idSet = await utils.db.table('files')
        .select('name')
        .then(rows => {
          return new Set(rows.map(row => row.name.split('.')[0]))
        })
      logger.log(`Cached ${utils.idSet.size} file identifiers`)
    }

    // Binds Express to port
    await safe.listen(utils.conf.port)
    logger.log(`lolisafe started on port ${utils.conf.port}`)

    // Cache control (safe.fiery.me)
    // Purge Cloudflare cache
    if (config.cacheControl && config.cacheControl !== 2) {
      if (config.cloudflare.purgeCache) {
        logger.log('Cache control enabled, purging Cloudflare\'s cache...')
        const results = await utils.purgeCloudflareCache(cdnPages)
        let errored = false
        let succeeded = 0
        for (const result of results) {
          if (result.errors.length) {
            if (!errored) errored = true
            result.errors.forEach(error => logger.log(`[CF]: ${error}`))
            continue
          }
          succeeded += result.files.length
        }
        if (!errored) {
          logger.log(`Successfully purged ${succeeded} cache`)
        }
      } else {
        logger.log('Cache control enabled without Cloudflare\'s cache purging')
      }
    }

    // Initiate internal periodical check ups of temporary uploads if required
    if (utils.retentions && utils.retentions.enabled && config.uploads.temporaryUploadsInterval > 0) {
      let temporaryUploadsInProgress = false
      const temporaryUploadCheck = async () => {
        if (temporaryUploadsInProgress) return

        temporaryUploadsInProgress = true
        try {
          const result = await utils.bulkDeleteExpired(false, isDevMode)

          if (result.expired.length || result.failed.length) {
            if (isDevMode) {
              let logMessage = `Expired uploads (${result.expired.length}): ${result.expired.map(_file => _file.name).join(', ')}`
              if (result.failed.length) {
                logMessage += `\nErrored (${result.failed.length}): ${result.failed.map(_file => _file.name).join(', ')}`
              }
              logger.debug(logMessage)
            } else {
              let logMessage = `Expired uploads: ${result.expired.length} deleted`
              if (result.failed.length) {
                logMessage += `, ${result.failed.length} errored`
              }
              logger.log(logMessage)
            }
          }
        } catch (error) {
          // Simply print-out errors, then continue
          logger.error(error)
        }

        temporaryUploadsInProgress = false
      }

      temporaryUploadCheck()
      setInterval(temporaryUploadCheck, config.uploads.temporaryUploadsInterval)
    }

    // NODE_ENV=development yarn start
    if (isDevMode) {
      const { inspect } = require('util')
      // Add readline interface to allow evaluating arbitrary JavaScript from console
      require('readline').createInterface({
        input: process.stdin
      }).on('line', line => {
        try {
          if (line === 'rs') return
          if (line === '.exit') return process.exit(0)
          // eslint-disable-next-line no-eval
          const evaled = eval(line)
          process.stdout.write(`${typeof evaled === 'string' ? evaled : inspect(evaled)}\n`)
        } catch (error) {
          process.stderr.write(`${error.stack}\n`)
        }
      }).on('SIGINT', () => {
        process.exit(0)
      })
      logger.log(utils.stripIndents(`!!! DEVELOPMENT MODE !!!
        [=] Nunjucks will auto rebuild (not live reload)
        [=] HTTP rate limits disabled
        [=] Readline interface enabled (eval arbitrary JS input)`))
    }
  } catch (error) {
    logger.error(error)
    process.exit(1)
  }
})()
