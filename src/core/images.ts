import Utils from './utils';
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
const util = Utils;
