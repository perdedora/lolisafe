const nunjucks = require('nunjucks')

class NunjucksRenderer {
  directory
  environment

  constructor (directory = '', options = {}) {
    if (typeof directory !== 'string') {
      throw new TypeError('Root directory must be a string value')
    }

    this.directory = directory

    this.environment = nunjucks.configure(
      this.directory,
      Object.assign(options, {
        autoescape: true
      })
    )
  }

  #middleware (req, res, next) {
    // Inject render() method into Response on each requests
    res.render = (path, params) => this.#render(res, path, params)
    return next()
  }

  #render (res, path, params) {
    return new Promise((resolve, reject) => {
      this.environment.render(`${path}.njk`, params, (err, html) => {
        if (err) return reject(err)
        resolve(html)
      })
    }).then(html => {
      return res.type('html').send(html)
    })
  }

  get middleware () {
    return this.#middleware.bind(this)
  }
}

module.exports = NunjucksRenderer
