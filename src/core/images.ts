export const images = () => {
    return {
        inlineAll: inlineAll,
        impl: {
            newImage: newImage
        }
    };

    function newImage(element: any) {
        return {
            inline: inline
        };

        function inline(get?: any) {
            if (util.isDataUrl(element.src)) return Promise.resolve();

            return Promise.resolve(element.src)
                .then(get || util.getAndEncode)
                .then(function (data) {
                    return util.dataAsUrl(data, util.mimeType(element.src));
                })
                .then(function (dataUrl) {
                    return new Promise(function (resolve, reject) {
                        element.onload = resolve;
                        element.onerror = reject;
                        element.src = dataUrl;
                    });
                });
        }
    }

    function inlineAll(node: Element | HTMLImageElement): any {
        if (!(node instanceof Element)) return Promise.resolve(node);

        return inlineBackground(node).then(function () {
            if (node instanceof HTMLImageElement) return newImage(node).inline();
            else
                return Promise.all(
                    util.asArray(node.childNodes).map(function (child: any) {
                        return inlineAll(child);
                    })
                );
        });

        function inlineBackground(node: any) {
            const background = node.style.getPropertyValue('background');

            if (!background) return Promise.resolve(node);

            return inliner
                .inlineAll(background)
                .then(function (inlined) {
                    node.style.setProperty('background', inlined, node.style.getPropertyPriority('background'));
                })
                .then(function () {
                    return node;
                });
        }
    }
};

function Util() {
    return {
        escape: escape,
        parseExtension: parseExtension,
        mimeType: mimeType,
        dataAsUrl: dataAsUrl,
        isDataUrl: isDataUrl,
        canvasToBlob: canvasToBlob,
        resolveUrl: resolveUrl,
        getAndEncode: getAndEncode,
        uid: uid(),
        delay: delay,
        asArray: asArray,
        escapeXhtml: escapeXhtml,
        makeImage: makeImage,
        width: width,
        height: height
    };

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

    function isDataUrl(url: string) {
        return url.search(/^(data:)/) !== -1;
    }

    function toBlob(canvas: HTMLCanvasElement) {
        return new Promise(function (resolve) {
            const binaryString = window.atob(canvas.toDataURL().split(',')[1]);
            const length = binaryString.length;
            const binaryArray = new Uint8Array(length);

            for (let i = 0; i < length; i++) binaryArray[i] = binaryString.charCodeAt(i);

            resolve(
                new Blob([binaryArray], {
                    type: 'image/png'
                })
            );
        });
    }

    function canvasToBlob(canvas: HTMLCanvasElement) {
        if (canvas.toBlob)
            return new Promise(function (resolve) {
                canvas.toBlob(resolve);
            });

        return toBlob(canvas);
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

    function uid() {
        let index = 0;

        return function () {
            return 'u' + fourRandomChars() + index++;

            function fourRandomChars() {
                return ('0000' + ((Math.random() * Math.pow(36, 4)) << 0).toString(36)).slice(-4);
            }
        };
    }

    function makeImage(uri: string) {
        return new Promise(function (resolve, reject) {
            const image = new Image();
            image.onload = function () {
                resolve(image);
            };
            image.onerror = reject;
            image.src = uri;
        });
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

    function dataAsUrl(content: string, type: string) {
        return 'data:' + type + ';base64,' + content;
    }

    function escape(string: string) {
        return string.replace(/([.*+?^${}()|\[\]\/\\])/g, '\\$1');
    }

    function delay(ms: number) {
        return function (arg: any) {
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(arg);
                }, ms);
            });
        };
    }

    function asArray<T>(arrayLike: ArrayLike<T>) {
        const array = [];
        const length = arrayLike.length;
        for (let i = 0; i < length; i++) array.push(arrayLike[i]);
        return array;
    }

    function escapeXhtml(string: string) {
        return string.replace(/#/g, '%23').replace(/\n/g, '%0A');
    }

    function width(node: any) {
        const leftBorder = px(node, 'border-left-width');
        const rightBorder = px(node, 'border-right-width');
        return node.scrollWidth + leftBorder + rightBorder;
    }

    function height(node: any) {
        const topBorder = px(node, 'border-top-width');
        const bottomBorder = px(node, 'border-bottom-width');
        return node.scrollHeight + topBorder + bottomBorder;
    }

    function px(node: any, styleProperty: string) {
        const value = window.getComputedStyle(node).getPropertyValue(styleProperty);
        return parseFloat(value.replace('px', ''));
    }
}

function newInliner() {
    const URL_REGEX = /url\(['"]?([^'"]+?)['"]?\)/g;

    return {
        inlineAll: inlineAll,
        shouldProcess: shouldProcess,
        impl: {
            readUrls: readUrls,
            inline: inline
        }
    };

    function shouldProcess(string: string) {
        return string.search(URL_REGEX) !== -1;
    }

    function readUrls(string: string) {
        const result = [];
        let match;
        while ((match = URL_REGEX.exec(string)) !== null) {
            result.push(match[1]);
        }
        return result.filter(function (url) {
            return !util.isDataUrl(url);
        });
    }

    function inline(string: string, url: string, baseUrl?: string, get?: any) {
        return Promise.resolve(url)
            .then(function (url) {
                return baseUrl ? util.resolveUrl(url, baseUrl) : url;
            })
            .then(get || util.getAndEncode)
            .then(function (data) {
                return util.dataAsUrl(data, util.mimeType(url));
            })
            .then(function (dataUrl) {
                return string.replace(urlAsRegex(url), '$1' + dataUrl + '$3');
            });

        function urlAsRegex(url: string) {
            return new RegExp('(url\\([\'"]?)(' + util.escape(url) + ')([\'"]?\\))', 'g');
        }
    }

    function inlineAll(string: string, baseUrl?: string, get?: any) {
        if (nothingToInline()) return Promise.resolve(string);

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
}

const inliner = newInliner();
const util = Util();
