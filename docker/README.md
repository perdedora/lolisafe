# Docker

If you want to avoid all the hassle of installing the dependencies, configuring nginx and so on you can try our docker image which makes things a bit simpler.

## Requirements

First make sure you have docker and docker composer installed, so please follow the install instructions for your OS/Distro:
- https://docs.docker.com/engine/install/debian/
- https://docs.docker.com/compose/install/

### Notice

This Docker configuration will use `node:18-bullseye` image by default (Debian Bullseye), which may result in relatively bigger image size, as compared to the likes of Alpine Linux.

Unfortunately, [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js/) requires platforms that Node considers "Tier 1", which does not include Alpine Linux and the likes (platforms that use `musl` instead of `glibc`).

https://github.com/nodejs/node/blob/main/BUILDING.md#platform-list

### Steps

- Navigate to this directory (`docker`).
- Copy the config file called `docker-compose.config.example.yml` and name it `docker-compose.config.yml` with the values you want. Those that are left commented will use the default values.
- Navigate to `nginx` directory, then copy either `lolisafe.tld.http.example.conf` or `lolisafe.tld.https.example.conf` and name it `lolisafe.tld.conf` for either HTTP or HTTPS.  
  If using HTTPS make sure to put your certificates into the `ssl` folder and name them accordingly:
  - `lolisafe.tld.crt` for the certificate
  - `lolisafe.tld.key` for the certificate key

Once you are done run the following commands:

- `./lolisafe.sh prod pull`
- `./lolisafe.sh prod build`
- `./lolisafe.sh prod up -d`

If you are on a Windows host, replace `./lolisafe.sh` with `.\lolisafe.ps1`.

Congrats, your lolisafe instance is now running.
