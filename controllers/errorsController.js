const path = require('path')
const paths = require('./pathsController')
const ClientError = require('./utils/ClientError')
const ServerError = require('./utils/ServerError')
const config = require('../config')
const logger = require('../logger')

const self = {
  errorPagesCodes: Object.keys(config.errorPages)
    .filter(key => /^\d+$/.test(key))
    .map(key => Number(key))
}

self.handleError = (req, res, error) => {
  if (!res || res.headersSent) {
    console.error('Error: Unexpected missing "res" object or headers alredy sent.')
    return console.error(error)
  }

  // Error messages that can be returned to users
  const isClientError = error instanceof ClientError
  const isServerError = error instanceof ServerError

  const logStack = (!isClientError && !isServerError) ||
    (isServerError && error.logStack)
  if (logStack) {
    logger.error(error)
  }

  const statusCode = (isClientError || isServerError)
    ? error.statusCode
    : 500

  const json = {}

  const description = (isClientError || isServerError)
    ? error.message
    : 'An unexpected error occurred. Try again?'
  if (description) {
    json.description = description
  }

  if ((isClientError || isServerError) && error.code) {
    json.code = error.code
  }

  res.setHeader('Cache-Control', 'no-store')

  if (Object.keys(json).length) {
    json.success = false
    return res.status(statusCode).json(json)
  } else {
    if (self.errorPagesCodes.includes(statusCode)) {
      return res.status(statusCode).sendFile(path.join(paths.errorRoot, config.errorPages[statusCode]))
    } else {
      return res.status(statusCode).end()
    }
  }
}

self.handleNotFound = (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(404).sendFile(path.join(paths.errorRoot, config.errorPages[404]))
}

module.exports = self
