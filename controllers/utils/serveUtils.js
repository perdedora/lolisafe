const self = {}

/*
* https://github.com/jshttp/fresh/blob/v0.5.2/index.js
* Copyright(c) 2012 TJ Holowaychuk
* Copyright(c) 2016-2017 Douglas Christopher Wilson
* MIT Licensed
*/

const CACHE_CONTROL_NO_CACHE_REGEXP = /(?:^|,)\s*?no-cache\s*?(?:,|$)/

self.fresh = (reqHeaders, resHeaders) => {
  // fields
  const modifiedSince = reqHeaders['if-modified-since']
  const noneMatch = reqHeaders['if-none-match']

  // unconditional request
  if (!modifiedSince && !noneMatch) {
    return false
  }

  // Always return stale when Cache-Control: no-cache
  // to support end-to-end reload requests
  // https://tools.ietf.org/html/rfc2616#section-14.9.4
  const cacheControl = reqHeaders['cache-control']
  if (cacheControl && CACHE_CONTROL_NO_CACHE_REGEXP.test(cacheControl)) {
    return false
  }

  // if-none-match
  if (noneMatch && noneMatch !== '*') {
    const etag = resHeaders.etag

    if (!etag) {
      return false
    }

    let etagStale = true
    const matches = self.parseTokenList(noneMatch)
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      if (match === etag || match === 'W/' + etag || 'W/' + match === etag) {
        etagStale = false
        break
      }
    }

    if (etagStale) {
      return false
    }
  }

  // if-modified-since
  if (modifiedSince) {
    const lastModified = resHeaders['last-modified']
    const modifiedStale = !lastModified || !(self.parseHttpDate(lastModified) <= self.parseHttpDate(modifiedSince))

    if (modifiedStale) {
      return false
    }
  }

  return true
}

self.isFresh = (req, res) => {
  return self.fresh(req.headers, {
    etag: res.get('ETag'),
    'last-modified': res.get('Last-Modified')
  })
}

/*
 * https://github.com/pillarjs/send/blob/0.18.0/index.js
 * Copyright(c) 2012 TJ Holowaychuk
 * Copyright(c) 2014-2022 Douglas Christopher Wilson
 * MIT Licensed
 */

self.isRangeFresh = (req, res) => {
  const ifRange = req.headers['if-range']

  if (!ifRange) {
    return true
  }

  // if-range as etag
  if (ifRange.indexOf('"') !== -1) {
    const etag = res.get('ETag')
    return Boolean(etag && ifRange.indexOf(etag) !== -1)
  }

  // if-range as modified date
  const lastModified = res.get('Last-Modified')
  return self.parseHttpDate(lastModified) <= self.parseHttpDate(ifRange)
}

self.isConditionalGET = req => {
  return req.headers['if-match'] ||
    req.headers['if-unmodified-since'] ||
    req.headers['if-none-match'] ||
    req.headers['if-modified-since']
}

self.isPreconditionFailure = (req, res) => {
  // if-match
  const match = req.headers['if-match']
  if (match) {
    const etag = res.get('ETag')
    return !etag || (match !== '*' && self.parseTokenList(match).every(match => {
      return match !== etag && match !== 'W/' + etag && 'W/' + match !== etag
    }))
  }

  // if-unmodified-since
  const unmodifiedSince = self.parseHttpDate(req.headers['if-unmodified-since'])
  if (!isNaN(unmodifiedSince)) {
    const lastModified = self.parseHttpDate(res.get('Last-Modified'))
    return isNaN(lastModified) || lastModified > unmodifiedSince
  }

  return false
}

/*
// TODO: ServeStatic may need these, but ServeLiveDirectory does its own (since it does not need Accept-Ranges support)
self.setHeader = (res, path, stat) => {
  if (this._acceptRanges && !res.get('Accept-Ranges')) {
    logger.debug('accept ranges')
    res.header('Accept-Ranges', 'bytes')
  }

  if (this._lastModified && !res.get('Last-Modified')) {
    const modified = stat.mtime.toUTCString()
    logger.debug('modified %s', modified)
    res.header('Last-Modified', modified)
  }

  if (this._etag && !res.get('ETag')) {
    const val = etag(stat)
    logger.debug('etag %s', val)
    res.header('ETag', val)
  }
}
*/

self.parseHttpDate = date => {
  const timestamp = date && Date.parse(date)

  return typeof timestamp === 'number'
    ? timestamp
    : NaN
}

self.parseTokenList = str => {
  let end = 0
  const list = []
  let start = 0

  // gather tokens
  for (let i = 0, len = str.length; i < len; i++) {
    switch (str.charCodeAt(i)) {
      case 0x20: /*   */
        if (start === end) {
          start = end = i + 1
        }
        break
      case 0x2c: /* , */
        if (start !== end) {
          list.push(str.substring(start, end))
        }
        start = end = i + 1
        break
      default:
        end = i + 1
        break
    }
  }

  // final token
  if (start !== end) {
    list.push(str.substring(start, end))
  }

  return list
}

module.exports = self
