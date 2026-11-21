/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "8f083ace07752e7a326ec2d38d9d5bd6"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "aecc9ac60a05cbdfcab59b9f4b865e9e"
  }, {
    "url": "pwa-512x512.png",
    "revision": "b91025a48f683553b6e9250bbf771cfe"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b7ea88a0ee8b02e5f47ea9e9ff2ddad8"
  }, {
    "url": "index.html",
    "revision": "23bbbbd673a5dc1d63584a9cebaaeff5"
  }, {
    "url": "icon.svg",
    "revision": "327b394c7ad9152f4b9015efe1096a5c"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "0f21d22113b7aa3c75e1b13af1d284dd"
  }, {
    "url": "assets/vendor-react-CiWTx1v9.js",
    "revision": null
  }, {
    "url": "assets/vendor-motion-Ct1E8gRU.js",
    "revision": null
  }, {
    "url": "assets/vendor-icons-BwYFgphf.js",
    "revision": null
  }, {
    "url": "assets/vendor-firestore-DDp6KGWJ.js",
    "revision": null
  }, {
    "url": "assets/vendor-firebase-core-bU4MfsJ_.js",
    "revision": null
  }, {
    "url": "assets/rolldown-runtime-BWaJ3C7D.js",
    "revision": null
  }, {
    "url": "assets/index-Qsv-4R3G.css",
    "revision": null
  }, {
    "url": "assets/index-DLQ551p-.js",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261121-171921_b960a377.png",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "0f21d22113b7aa3c75e1b13af1d284dd"
  }, {
    "url": "icon.svg",
    "revision": "327b394c7ad9152f4b9015efe1096a5c"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b7ea88a0ee8b02e5f47ea9e9ff2ddad8"
  }, {
    "url": "pwa-512x512.png",
    "revision": "b91025a48f683553b6e9250bbf771cfe"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "aecc9ac60a05cbdfcab59b9f4b865e9e"
  }, {
    "url": "manifest.webmanifest",
    "revision": "b48611801faff0f49a03c40a8be9665c"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//]
  }));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
