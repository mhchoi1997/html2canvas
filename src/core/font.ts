import Utils from './utils';

interface IPropertyDescriptor<T> {
    resolve: () => Promise<T>;
    src: () => T;
}

class Font {
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
        const URL_REGEX = /url\(['"]?([^'"]+?)['"]?\)/g;

        return Promise.resolve(utils.asArray(document.styleSheets))
            .then(getCssRules)
            .then(selectWebFontRules)
            .then(function (rules) {
                return rules.map(newWebFont);
            });

        function shouldProcess(string: string) {
            return string.search(URL_REGEX) !== -1;
        }

        async function inlineAll(string: string, baseUrl: string) {
            if (nothingToInline()) return Promise.resolve(string);

            function readUrls(string: string) {
                const result = [];
                let match;
                while ((match = URL_REGEX.exec(string)) !== null) {
                    result.push(match[1]);
                }
                return result.filter(function (url) {
                    return !utils.isDataUrl(url);
                });
            }

            async function inline(string: string, url: string, baseUrl: string) {
                return Promise.resolve(url)
                    .then(function (url) {
                        return baseUrl ? utils.resolveUrl(url, baseUrl) : url;
                    })
                    .then(utils.getAndEncode)
                    .then(function (data: string) {
                        return utils.dataAsUrl(data, utils.mimeType(url));
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
                    utils.asArray(sheet.cssRules || []).forEach(cssRules.push.bind(cssRules));
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
}

// 폰트 관련 추가
export const fontFaces = new Font();
const utils = Utils;
