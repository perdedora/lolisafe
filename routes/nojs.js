const { Router } = require('hyper-express')
const routes = new Router()
const upload = require('./../controllers/uploadController')
const utils = require('./../controllers/utilsController')
const config = require('./../config')

routes.get('/nojs', async (req, res) => {
  // TODO: Update res.render() to allow bypassing cache on demand,
  // so that this GET route can instead re-use persistent cache
  return res.render('nojs', {
    config, utils, versions: utils.versionStrings
  })
})

// HyperExpress defaults to 250kb
// https://github.com/kartikk221/hyper-express/blob/6.4.4/docs/Server.md#server-constructor-options
const maxBodyLength = parseInt(config.uploads.maxSize) * 1e6
routes.post('/nojs', { max_body_length: maxBodyLength }, async (req, res) => {
  // Map built-in Response.json() function into Response.render() accordingly
  // Since NoJS uploader needs to reply with a complete HTML page
  res._json = res.json
  res.json = (...args) => {
    const result = args[0]
    return res.render('nojs', {
      config,
      utils,
      versions: utils.versionStrings,
      errorMessage: result.success ? '' : (result.description || 'An unexpected error occurred.'),
      files: result.files || [{}]
    })
  }
  return upload.upload(req, res)
})

module.exports = routes
