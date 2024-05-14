class Image {
    async resolveAll() {
        return this._readAll()
            .then(function (webFonts) {
                return Promise.all(
                    webFonts.map(function (webFont: IPropertyDescriptor<string>) {
                        return webFont.resolve();
                    })
                );
            })
            .then(function (cssStrings) {
                return cssStrings.join('\n');
            });
    }

    private _readAll() {
        return Promise.resolve(Image.asArray(document.images))
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

        async function inlineAll(string: string, baseUrl: string) {
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

            function dataAsUrl(content: unknown, type: string) {
                return 'data:' + type + ';base64,' + content;
            }

            function mimes() {
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
                return mimes()[extension];
            }

            async function inline(string: string, url: string, baseUrl: string) {
                return Promise.resolve(url)
                    .then(function (url) {
                        return baseUrl ? resolveUrl(url, baseUrl) : url;
                    })
                    .then(Resource.getAndEncode)
                    .then(function (data) {
                        return dataAsUrl(data, mimeType(url));
                    })
                    .then(function (dataUrl) {
                        return string.replace(urlAsRegex(url), '$1' + dataUrl + '$3');
                    });

                function urlAsRegex(url: string) {
                    return new RegExp('(url\\([\'"]?)(' + url + ')([\'"]?\\))', 'g');
                }
            }

            return Promise.resolve(string)
                .then(readUrls)
                .then(function (urls) {
                    let done = Promise.resolve(string);
                    urls.forEach(function (url) {
                        done = done.then(function (string) {
                            return inline(string, url, baseUrl);
                        });
                    });
                    return done;
                });

            function nothingToInline() {
                return !shouldProcess(string);
            }
        }

        function selectWebFontRules(cssRules: Array<CSSRule>) {
            return cssRules
                .filter(function (rule: CSSRule) {
                    return rule.type === CSSRule.FONT_FACE_RULE;
                })
                .filter(function (rule: CSSFontFaceRule) {
                    return shouldProcess(rule.style.getPropertyValue('src'));
                });
        }

        function getCssRules(styleSheets: Array<CSSStyleSheet>): Array<CSSRule> {
            const cssRules: Array<CSSRule> = [];
            styleSheets.forEach(function (sheet: CSSStyleSheet) {
                try {
                    Font.asArray(sheet.cssRules || []).forEach(cssRules.push.bind(cssRules));
                } catch (e) {
                    console.warn(`Error while reading CSS rules from ${sheet.href}, ${e.toString()}`);
                }
            });
            return cssRules;
        }

        function newWebFont(webFontRule: CSSFontFaceRule): IPropertyDescriptor<string> {
            return {
                resolve: function () {
                    const baseUrl = (webFontRule.parentStyleSheet || {}).href ?? '';
                    return inlineAll(webFontRule.cssText, baseUrl);
                },
                src: function () {
                    return webFontRule.style.getPropertyValue('src');
                }
            };
        }
    }

    // 유사 배열 객체를 받아서 배열로 변환시켜준다.
    static asArray(arrayLike: ArrayLike<unknown>) {
        const array = [];
        const length = arrayLike.length;
        for (let i = 0; i < length; i++) array.push(arrayLike[i]);
        return array;
    }
}

export const imagesFace = new Image();
