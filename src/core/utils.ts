interface IMime {
    woff: 'application/font-woff';
    woff2: 'application/font-woff';
    ttf: 'application/font-truetype';
    eot: 'application/vnd.ms-fontobject';
    png: 'image/png';
    jpg: 'image/jpeg';
    jpeg: 'image/jpeg';
    gif: 'image/gif';
    tiff: 'image/tiff';
    svg: 'image/svg+xml';
}

type UidFuncType = () => string;
type DelayFuncType = (arg: number) => Promise<unknown>;

export default class Utils {
    // ArrayLike<T>타입을 Array<T>으로 반환한다.
    static asArray<T>(arrayLike: ArrayLike<T>): Array<T> {
        return Array.from(arrayLike);
    }

    static mimes(): IMime {
        /*
         * Only WOFF and EOT mime types for fonts are 'real'
         * see http://www.iana.org/assignments/media-types/media-types.xhtml
         */
        const WOFF = 'application/font-woff';
        const JPEG = 'image/jpeg';

        return {
            woff: WOFF,
            woff2: WOFF,
            jpg: JPEG,
            jpeg: JPEG,
            ttf: 'application/font-truetype',
            eot: 'application/vnd.ms-fontobject',
            png: 'image/png',
            gif: 'image/gif',
            tiff: 'image/tiff',
            svg: 'image/svg+xml'
        };
    }

    static parseExtension(url: string): string {
        // 확장자 정규 표현식을 사용하여 체크
        const extensionMatch = /\.(^[\.\/]*?)$/g.exec(url);
        return extensionMatch ? extensionMatch[1] : '';
    }

    static mimeType(url: string): string {
        const resourceMimes = this.mimes(); // MIME객체를 가져오고...
        const extension = this.parseExtension(url).toLowerCase() as keyof typeof resourceMimes; // url의 확장자를 가지고 소문자로 변환
        return resourceMimes[extension] ?? ''; // MIME객체에 해당하는 확장자가 있는지 검사 후 있으면 값을 가져오고, 아니면 공백문자로 처리한다.
    }

    static isDataUrl(url: string): boolean {
        // url이 data url인지 검사한다.
        return url.search(/^(data:)/) !== -1;
    }

    /**
     * Canvas를 Blob객체로 변환
     * @param canvas
     * @returns
     */
    static toBlob(canvas: HTMLCanvasElement): Promise<unknown> {
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

    static resolveUrl(url: string, baseUrl: string): string {
        const doc = document.implementation.createHTMLDocument();
        const base = doc.createElement('base');
        doc.head.appendChild(base);
        const a = doc.createElement('a');
        doc.body.appendChild(a);
        base.href = baseUrl;
        a.href = url;
        return a.href;
    }

    static uid(): UidFuncType {
        let index = 0;

        return function () {
            return 'u' + fourRandomChars() + index++;

            function fourRandomChars() {
                return ('0000' + ((Math.random() * Math.pow(36, 4)) << 0).toString(36)).slice(-4);
            }
        };
    }

    static makeImage(uri: string): Promise<unknown> {
        return new Promise(function (resolve, reject) {
            const image = new Image();
            image.onload = function () {
                resolve(image);
            };
            image.onerror = reject;
            image.src = uri;
        });
    }

    static getAndEncode(url: string): Promise<unknown> {
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

    static dataAsUrl(content: string, type: string): string {
        return 'data:' + type + ';base64,' + content;
    }

    static escape(string: string): string {
        return string.replace(/([.*+?^${}()|\[\]\/\\])/g, '\\$1');
    }

    static delay(ms: number): DelayFuncType {
        return function (arg: unknown) {
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(arg);
                }, ms);
            });
        };
    }

    static escapeXhtml(string: string): string {
        return string.replace(/#/g, '%23').replace(/\n/g, '%0A');
    }

    static width(node: HTMLElement): number {
        const leftBorder = this.px(node, 'border-left-width');
        const rightBorder = this.px(node, 'border-right-width');
        return node.scrollWidth + leftBorder + rightBorder;
    }

    static height(node: HTMLElement): number {
        const topBorder = this.px(node, 'border-top-width');
        const bottomBorder = this.px(node, 'border-bottom-width');
        return node.scrollHeight + topBorder + bottomBorder;
    }

    static px(node: HTMLElement, styleProperty: string): number {
        const value = window.getComputedStyle(node).getPropertyValue(styleProperty);
        return parseFloat(value.replace('px', ''));
    }
}
