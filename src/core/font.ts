// 폰트 관련 추가
export const fontFaces = newFontFaces();

function newFontFaces() {
    return {
        resolveAll: resolveAll,
        impl: {
            readAll: readAll
        }
    };

    function asArray(arrayLike: any) {
        const array = [];
        const length = arrayLike.length;
        for (let i = 0; i < length; i++) array.push(arrayLike[i]);
        return array;
    }

    function resolveAll() {
        return readAll()
            .then(function (webFonts) {
                return Promise.all(
                    webFonts.map(function (webFont: any) {
                        return webFont.resolve();
                    })
                );
            })
            .then(function (cssStrings) {
                return cssStrings.join('\n');
            });
    }

    function readAll() {
        return Promise.resolve(asArray(document.styleSheets))
            .then(getCssRules)
            .then(selectWebFontRules)
            .then(function (rules) {
                return rules.map(newWebFont);
            });

        function shouldProcess(string: string) {
            const URL_REGEX = /url\(['"]?([^'"]+?)['"]?\)/g;
            return string.search(URL_REGEX) !== -1;
        }

        function isDataUrl(url: string) {
            return url.search(/^(data:)/) !== -1;
        }

        function inlineAll(string: string, baseUrl: any, get: any) {
            if (nothingToInline()) return Promise.resolve(string);

            function readUrls(string: string) {
                const result = [];
                const URL_REGEX = /url\(['"]?([^'"]+?)['"]?\)/g;
                let match;
                while ((match = URL_REGEX.exec(string)) !== null) {
                    result.push(match[1]);
                }
                return result.filter(function (url) {
                    return !isDataUrl(url);
                });
            }

            function resolveUrl(url: string, baseUrl: string) {
                const doc = document.implementation.createHTMLDocument();
                const base = doc.createElement('base');
                doc.head.appendChild(base);
                const a = doc.createElement('a');
                doc.body.appendChild(a);
                base.href = baseUrl;
                a.href = url;
                return a.href;
            }

            function dataAsUrl(content: any, type: any) {
                return 'data:' + type + ';base64,' + content;
            }

            function mimes() {
                /*
                 * Only WOFF and EOT mime types for fonts are 'real'
                 * see http://www.iana.org/assignments/media-types/media-types.xhtml
                 */
                const WOFF = 'application/font-woff';
                const JPEG = 'image/jpeg';

                return {
                    woff: WOFF,
                    woff2: WOFF,
                    ttf: 'application/font-truetype',
                    eot: 'application/vnd.ms-fontobject',
                    png: 'image/png',
                    jpg: JPEG,
                    jpeg: JPEG,
                    gif: 'image/gif',
                    tiff: 'image/tiff',
                    svg: 'image/svg+xml'
                };
            }

            function parseExtension(url: string) {
                const match = /\.([^\.\/]*?)$/g.exec(url);
                if (match) return match[1];
                else return '';
            }

            function mimeType(url: string) {
                const resourceMimes = mimes();
                const extension = parseExtension(url).toLowerCase() as keyof typeof resourceMimes;
                return mimes()[extension] || '';
            }

            function getAndEncode(url: string) {
                const TIMEOUT = 30000;

                return new Promise(function (resolve) {
                    const request = new XMLHttpRequest();

                    request.onreadystatechange = done;
                    request.ontimeout = timeout;
                    request.responseType = 'blob';
                    request.timeout = TIMEOUT;
                    request.open('GET', url, true);
                    request.send();

                    function done() {
                        if (request.readyState !== 4) return;

                        if (request.status !== 200) {
                            fail('cannot fetch resource: ' + url + ', status: ' + request.status);
                            return;
                        }

                        const encoder = new FileReader();
                        encoder.onloadend = function () {
                            if (typeof encoder.result == 'string') {
                                const content = encoder.result.split(/,/)[1];
                                resolve(content);
                            }
                            resolve('');
                        };
                        encoder.readAsDataURL(request.response);
                    }

                    function timeout() {
                        fail('timeout of ' + TIMEOUT + 'ms occured while fetching resource: ' + url);
                    }

                    function fail(message: string) {
                        console.error(message);
                        resolve('');
                    }
                });
            }

            function inline(string: string, url: string, baseUrl: string, get: any) {
                return Promise.resolve(url)
                    .then(function (url) {
                        return baseUrl ? resolveUrl(url, baseUrl) : url;
                    })
                    .then(get || getAndEncode)
                    .then(function (data) {
                        return dataAsUrl(data, mimeType(url));
                    })
                    .then(function (dataUrl) {
                        return string.replace(urlAsRegex(url), '$1' + dataUrl + '$3');
                    });

                function urlAsRegex(url: string) {
                    // return new RegExp('(url\\([\'"]?)(' + escape(url) + ')([\'"]?\\))', 'g');
                    return new RegExp('(url\\([\'"]?)(' + url + ')([\'"]?\\))', 'g');
                }
            }

            return Promise.resolve(string)
                .then(readUrls)
                .then(function (urls) {
                    let done = Promise.resolve(string);
                    urls.forEach(function (url) {
                        done = done.then(function (string) {
                            return inline(string, url, baseUrl, get);
                        });
                    });
                    return done;
                });

            function nothingToInline() {
                return !shouldProcess(string);
            }
        }

        function selectWebFontRules(cssRules: any) {
            return cssRules
                .filter(function (rule: any) {
                    return rule.type === CSSRule.FONT_FACE_RULE;
                })
                .filter(function (rule: any) {
                    return shouldProcess(rule.style.getPropertyValue('src'));
                });
        }

        function getCssRules(styleSheets: any): any[] {
            const cssRules: any[] = [];
            styleSheets.forEach(function (sheet: any) {
                try {
                    asArray(sheet.cssRules || []).forEach(cssRules.push.bind(cssRules));
                } catch (e) {
                    console.warn('Error while reading CSS rules from ' + sheet.href, e.toString());
                }
            });
            return cssRules;
        }

        function newWebFont(webFontRule: any) {
            return {
                resolve: function resolve() {
                    const baseUrl = (webFontRule.parentStyleSheet || {}).href;
                    return inlineAll(webFontRule.cssText, baseUrl, null);
                },
                src: function () {
                    return webFontRule.style.getPropertyValue('src');
                }
            };
        }
    }
}
