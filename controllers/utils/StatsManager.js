const jetpack = require('fs-jetpack')
const si = require('systeminformation')
const paths = require('./../pathsController')
const perms = require('./../permissionController')
const Constants = require('./Constants')
const logger = require('./../../logger')

const Type = Object.freeze({
  // Should contain key value: number
  UPTIME: 'uptime',
  // Should contain key value: number
  BYTE: 'byte',
  // Should contain key value: { used: number, total: number }
  BYTE_USAGE: 'byteUsage',
  // Should contain key value: number
  TEMP_CELSIUS: 'tempC',
  // Should contain key data: Array<{ key: string, value: number | string }>
  // and optionally a count/total
  DETAILED: 'detailed',
  // Should contain key value: null
  // May consider still displaying entries with this type in the frontend,
  // but mark as unavailable explicitly due to backend lacking the capabilities
  UNAVAILABLE: 'unavailable',
  // Hidden type should be skipped during iteration, can contain anything
  // These should be treated on a case by case basis on the frontend
  HIDDEN: 'hidden'
})

const self = {
  _buildExtsRegex: exts => {
    const str = exts.map(ext => ext.substring(1)).join('|')
    return new RegExp(`\\.(${str})$`, 'i')
  },

  cachedStats: {}
}

self.imageExtsRegex = self._buildExtsRegex(Constants.IMAGE_EXTS)
self.videoExtsRegex = self._buildExtsRegex(Constants.VIDEO_EXTS)
self.audioExtsRegex = self._buildExtsRegex(Constants.AUDIO_EXTS)

self.invalidateStatsCache = type => {
  if (!self.cachedStats[type]) return
  self.cachedStats[type].cache = null
}

self.getSystemInfo = async () => {
  const os = await si.osInfo()
  const cpu = await si.cpu()
  const cpuTemperature = await si.cpuTemperature()
  const currentLoad = await si.currentLoad()
  const mem = await si.mem()
  const time = si.time()

  return {
    Platform: `${os.platform} ${os.arch}`,
    Distro: `${os.distro} ${os.release}`,
    Kernel: os.kernel,
    CPU: `${cpu.cores} \u00d7 ${cpu.manufacturer} ${cpu.brand} @ ${cpu.speed.toFixed(2)}GHz`,
    'CPU Load': `${currentLoad.currentLoad.toFixed(1)}%`,
    'CPUs Load': currentLoad.cpus.map(cpu => `${cpu.load.toFixed(1)}%`).join(', '),
    'CPU Temperature': cpuTemperature && typeof cpuTemperature.main === 'number'
      ? {
          value: cpuTemperature.main,
          // Temperature value from this library is hard-coded to Celsius
          type: Type.TEMP_CELSIUS
        }
      : { value: null, type: Type.UNAVAILABLE },
    Memory: {
      value: {
        used: mem.active,
        total: mem.total
      },
      type: Type.BYTE_USAGE
    },
    Swap: mem && typeof mem.swaptotal === 'number' && mem.swaptotal > 0
      ? {
          value: {
            used: mem.swapused,
            total: mem.swaptotal
          },
          type: Type.BYTE_USAGE
        }
      : { value: null, type: Type.UNAVAILABLE },
    Uptime: {
      value: Math.floor(time.uptime),
      type: Type.UPTIME
    }
  }
}

self.getServiceInfo = async () => {
  const nodeUptime = process.uptime()

  /*
    if (self.scan.instance) {
      try {
        self.scan.version = await self.scan.instance.getVersion().then(s => s.trim())
      } catch (error) {
        logger.error(error)
        self.scan.version = 'Errored when querying version.'
      }
    }
    */

  return {
    'Node.js': `${process.versions.node}`,
    // Scanner: self.scan.version || 'N/A',
    'Memory Usage': {
      value: process.memoryUsage().rss,
      type: Type.BYTE
    },
    Uptime: {
      value: Math.floor(nodeUptime),
      type: Type.UPTIME
    }
  }
}

self.getFileSystems = async () => {
  const fsSize = await si.fsSize()

  const stats = {}

  for (const fs of fsSize) {
    const obj = {
      value: {
        total: fs.size,
        used: fs.used
      },
      type: Type.BYTE_USAGE
    }
    // "available" is a new attribute in systeminformation v5, only tested on Linux,
    // so add an if-check just in case its availability is limited in other platforms
    if (typeof fs.available === 'number') {
      obj.value.available = fs.available
    }
    stats[`${fs.fs} (${fs.type}) on ${fs.mount}`] = obj
  }

  return stats
}

self.getUploadsStats = async db => {
  const uploads = await db.table('files')
    .select('name', 'type', 'size', 'expirydate')

  const stats = {
    Total: uploads.length,
    Images: 0,
    Videos: 0,
    Audios: 0,
    Others: 0,
    Temporary: 0,
    'Size in DB': {
      value: 0,
      type: Type.BYTE
    },
    'Mime Types': {
      value: {},
      type: Type.DETAILED
    }
  }

  for (const upload of uploads) {
    if (self.imageExtsRegex.test(upload.name)) {
      stats.Images++
    } else if (self.videoExtsRegex.test(upload.name)) {
      stats.Videos++
    } else if (self.audioExtsRegex.test(upload.name)) {
      stats.Audios++
    } else {
      stats.Others++
    }

    if (upload.expirydate !== null) {
      stats.Temporary++
    }

    stats['Size in DB'].value += parseInt(upload.size)

    if (stats['Mime Types'].value[upload.type] === undefined) {
      stats['Mime Types'].value[upload.type] = 0
    }

    stats['Mime Types'].value[upload.type]++
  }

  return stats
}

self.getUsersStats = async db => {
  const stats = {
    Total: 0,
    Disabled: 0,
    Usergroups: {
      value: {},
      type: Type.DETAILED
    }
  }

  const permissionKeys = Object.keys(perms.permissions).reverse()
  permissionKeys.forEach(p => {
    stats.Usergroups.value[p] = 0
  })

  const users = await db.table('users')
  stats.Total = users.length
  for (const user of users) {
    if (user.enabled === false || user.enabled === 0) {
      stats.Disabled++
    }

    user.permission = user.permission || 0
    for (const p of permissionKeys) {
      if (user.permission === perms.permissions[p]) {
        stats.Usergroups.value[p]++
        break
      }
    }
  }

  return stats
}

self.getAlbumsStats = async db => {
  const stats = {
    Total: 0,
    Disabled: 0,
    Public: 0,
    Downloadable: 0,
    'ZIP Generated': 0
  }

  const albums = await db.table('albums')
  stats.Total = albums.length

  const activeAlbums = []
  for (const album of albums) {
    if (!album.enabled) {
      stats.Disabled++
      continue
    }
    activeAlbums.push(album.id)
    if (album.download) stats.Downloadable++
    if (album.public) stats.Public++
  }

  const files = await jetpack.listAsync(paths.zips)
  if (Array.isArray(files)) {
    stats['ZIP Generated'] = files.length
  }

  stats['Files in albums'] = await db.table('files')
    .whereIn('albumid', activeAlbums)
    .count('id as count')
    .then(rows => rows[0].count)

  return stats
}

self.statGenerators = {
  system: {
    title: 'System',
    funct: self.getSystemInfo,
    maxAge: 1000
  },
  service: {
    title: 'Service',
    funct: self.getServiceInfo,
    maxAge: 500
  },
  fileSystems: {
    title: 'File Systems',
    funct: self.getFileSystems,
    maxAge: 60000
  },
  uploads: {
    title: 'Uploads',
    funct: self.getUploadsStats,
    maxAge: -1
  },
  users: {
    title: 'Users',
    funct: self.getUsersStats,
    maxAge: -1
  },
  albums: {
    title: 'Albums',
    funct: self.getAlbumsStats,
    maxAge: -1
  }
}

self.statNames = Object.keys(self.statGenerators)

self.generateStats = async db => {
  await Promise.all(self.statNames.map(async name => {
    const generator = self.statGenerators[name]

    if (!self.cachedStats[name]) {
      self.cachedStats[name] = {
        cache: null,
        generating: false,
        generatedOn: 0
      }
    }

    // Skip if still generating
    if (self.cachedStats[name].generating) return

    if (self.cachedStats[name].cache && typeof generator.maxAge === 'number') {
      // Skip if maxAge is negative (requires cache to be invaildated via other means),
      // or cache still satisfies maxAge
      if (generator.maxAge < 0 || (Date.now() - self.cachedStats[name].generatedOn <= generator.maxAge)) {
        return
      }
    }

    self.cachedStats[name].generating = true

    logger.debug(`${name}: Generating\u2026`)
    self.cachedStats[name].cache = await generator.funct(db)
      .catch(error => {
        logger.error(error)
        return null
      })

    self.cachedStats[name].generatedOn = Date.now()
    self.cachedStats[name].generating = false
    logger.debug(`${name}: OK`)
  }))

  return self.statNames.reduce((acc, name) => {
    const title = self.statGenerators[name].title
    acc[title] = {
      ...(self.cachedStats[name].cache || {}),
      meta: {
        cached: Boolean(self.cachedStats[name].cache),
        generatedOn: self.cachedStats[name].generatedOn,
        maxAge: typeof self.statGenerators[name].maxAge === 'number'
          ? self.statGenerators[name].maxAge
          : null
      }
    }
    return acc
  }, {})
}

module.exports = self
