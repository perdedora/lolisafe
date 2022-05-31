const routes = require('express').Router()
const utils = require('./../controllers/utilsController')
const config = require('./../config')

routes.get('/v/:identifier/tags', (req, res) => utils.viewMetadata(req, res))

routes.get(
  '/v/:identifier', async (req, res, next) => {
  // Uploads identifiers parsing, etc., are strictly handled by client-side JS at src/js/player.js
    return res.render('player', {
      config,
      versions: utils.versionStrings
    })
  })

module.exports = routes
