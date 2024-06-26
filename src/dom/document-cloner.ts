import {Bounds} from '../css/layout/bounds';
import {
    isAudioElement,
    isBodyElement,
    isCanvasElement,
    isCustomElement,
    isElementNode,
    isHTMLElementNode,
    isIFrameElement,
    isImageElement,
    isInputElement,
    isScriptElement,
    isSelectElement,
    isSlotElement,
    isStyleElement,
    isSVGElementNode,
    isTextareaElement,
    isTextNode,
    isVideoElement
} from './node-parser';
import {isIdentToken, nonFunctionArgSeparator} from '../css/syntax/parser';
import {TokenType} from '../css/syntax/tokenizer';
import {CounterState, createCounterText} from '../css/types/functions/counter';
import {LIST_STYLE_TYPE, listStyleType} from '../css/property-descriptors/list-style-type';
import {CSSParsedCounterDeclaration, CSSParsedPseudoDeclaration} from '../css/index';
import {getQuote} from '../css/property-descriptors/quotes';
import {Context} from '../core/context';
import {DebuggerType, isDebugging} from '../core/debugger';

export interface CloneOptions {
    ignoreElements?: (element: Element) => boolean;
    onclone?: (document: Document, element: HTMLElement) => void;
    allowTaint?: boolean;
}

export interface WindowOptions {
    scrollX: number;
    scrollY: number;
    windowWidth: number;
    windowHeight: number;
}

export type CloneConfigurations = CloneOptions & {
    inlineImages: boolean;
    copyStyles: boolean;
    fontStyle?: string | null;
};

const IGNORE_ATTRIBUTE = 'data-html2canvas-ignore';

export class DocumentCloner {
    private readonly scrolledElements: [Element, number, number][];
    private readonly referenceElement: HTMLElement;
    clonedReferenceElement?: HTMLElement;
    private readonly documentElement: HTMLElement;
    private readonly counters: CounterState;
    private quoteDepth: number;

    constructor(
        private readonly context: Context,
        element: HTMLElement,
        private readonly options: CloneConfigurations
    ) {
        this.scrolledElements = [];
        this.referenceElement = element;
        this.counters = new CounterState();
        this.quoteDepth = 0;
        if (!element.ownerDocument) {
            throw new Error('Cloned element does not have an owner document');
        }

        this.documentElement = this.cloneNode(element.ownerDocument.documentElement, false) as HTMLElement;
    }

    toIFrame(ownerDocument: Document, windowSize: Bounds): Promise<HTMLIFrameElement> {
        return new Promise((resolve, reject) => {
            const iframe: HTMLIFrameElement = createIFrameContainer(ownerDocument, windowSize);

            if (!iframe.contentWindow) {
                return reject(`Unable to find iframe window`);
            }

            const scrollX = (ownerDocument.defaultView as Window).pageXOffset;
            const scrollY = (ownerDocument.defaultView as Window).pageYOffset;

            const cloneWindow = iframe.contentWindow;
            const documentClone: Document = cloneWindow.document;

            /* Chrome doesn't detect relative background-images assigned in inline <style> sheets when fetched through getComputedStyle
            if window url is about:blank, we can assign the url to current by writing onto the document
            */

            const iframeLoad = iframeLoader(iframe).then(async () => {
                this.scrolledElements.forEach(restoreNodeScroll);
                if (cloneWindow) {
                    cloneWindow.scrollTo(windowSize.left, windowSize.top);
                    if (
                        /(iPad|iPhone|iPod)/g.test(navigator.userAgent) &&
                        (cloneWindow.scrollY !== windowSize.top || cloneWindow.scrollX !== windowSize.left)
                    ) {
                        this.context.logger.warn('Unable to restore scroll position for cloned document');
                        this.context.windowBounds = this.context.windowBounds.add(
                            cloneWindow.scrollX - windowSize.left,
                            cloneWindow.scrollY - windowSize.top,
                            0,
                            0
                        );
                    }
                }

                const onclone = this.options.onclone;

                const referenceElement = this.clonedReferenceElement;

                if (typeof referenceElement === 'undefined') {
                    return Promise.reject(`Error finding the ${this.referenceElement.nodeName} in the cloned document`);
                }

                documentClone.fonts.ready
                    .then(() => {
                        return true;
                    })
                    .then(async () => {
                        if (/(AppleWebKit)/g.test(navigator.userAgent)) {
                            await imagesReady(documentClone);
                        }

                        if (typeof onclone === 'function') {
                            return Promise.resolve()
                                .then(() => onclone(documentClone, referenceElement))
                                .then(() => iframe);
                        }

                        resolve(iframe);
                    });
            });

            documentClone.open();
            documentClone.write(`${serializeDoctype(document.doctype)}<html></html>`);
            // Chrome scrolls the parent document for some reason after the write to the cloned window???
            restoreOwnerScroll(this.referenceElement.ownerDocument, scrollX, scrollY);
            documentClone.replaceChild(documentClone.adoptNode(this.documentElement), documentClone.documentElement);
            documentClone.close();
            return iframeLoad;
        });
    }

    createElementClone<T extends HTMLElement | SVGElement>(node: T): HTMLElement | SVGElement {
        if (isDebugging(node, DebuggerType.CLONE)) {
            debugger;
        }
        if (isCanvasElement(node)) {
            return this.createCanvasClone(node);
        }
        if (isVideoElement(node)) {
            // video를 canvas가 아닌 image로 반환해야한다.
            return this.createVideoClone(node);
        }
        if (isStyleElement(node)) {
            return this.createStyleClone(node);
        }

        const clone = node.cloneNode(false) as T;

        if (isImageElement(clone)) {
            if (isImageElement(node) && node.currentSrc && node.currentSrc !== node.src) {
                clone.src = node.currentSrc;
                clone.srcset = '';
            }

            if (clone.loading === 'lazy') {
                clone.loading = 'eager';
            }

            if (this.options.inlineImages) {
                this.context.cache.has(clone.src) &&
                    this.context.cache.match(clone.src).then((img) => (clone.src = img.src));
            }
        }

        if (isCustomElement(clone)) {
            return this.createCustomElementClone(clone);
        }

        return clone;
    }

    createCustomElementClone(node: HTMLElement): HTMLElement {
        const clone = document.createElement('html2canvascustomelement');
        copyCSSStyles(node.style, clone, this.options, this.context);

        return clone;
    }

    createStyleClone(node: HTMLStyleElement): HTMLStyleElement {
        try {
            const sheet = node.sheet as CSSStyleSheet | undefined;
            if (sheet && sheet.cssRules) {
                const css: string = [].slice.call(sheet.cssRules, 0).reduce((css: string, rule: CSSRule) => {
                    if (rule && typeof rule.cssText === 'string') {
                        return css + rule.cssText;
                    }
                    return css;
                }, '');
                const style = node.cloneNode(false) as HTMLStyleElement;
                style.textContent = css;
                return style;
            }
        } catch (e) {
            // accessing node.sheet.cssRules throws a DOMException
            this.context.logger.error('Unable to access cssRules property', e);
            if (e.name !== 'SecurityError') {
                throw e;
            }
        }
        return node.cloneNode(false) as HTMLStyleElement;
    }

    createCanvasClone(canvas: HTMLCanvasElement): HTMLImageElement | HTMLCanvasElement {
        if (this.options.inlineImages && canvas.ownerDocument) {
            const img = canvas.ownerDocument.createElement('img');
            try {
                img.src = canvas.toDataURL();
                return img;
            } catch (e) {
                this.context.logger.info(`Unable to inline canvas contents, canvas is tainted`, canvas);
            }
        }

        const clonedCanvas = canvas.cloneNode(false) as HTMLCanvasElement;

        try {
            clonedCanvas.width = canvas.width;
            clonedCanvas.height = canvas.height;
            const ctx = canvas.getContext('2d');
            const clonedCtx = clonedCanvas.getContext('2d');
            if (clonedCtx) {
                if (!this.options.allowTaint && ctx) {
                    clonedCtx.putImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), 0, 0);
                } else {
                    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
                    if (gl) {
                        const attribs = gl.getContextAttributes();
                        if (attribs?.preserveDrawingBuffer === false) {
                            this.context.logger.warn(
                                'Unable to clone WebGL context as it has preserveDrawingBuffer=false',
                                canvas
                            );
                        }
                    }

                    clonedCtx.drawImage(canvas, 0, 0);
                }
            }
            return clonedCanvas;
        } catch (e) {
            this.context.logger.info(`Unable to clone canvas as it is tainted`, canvas);
        }

        return clonedCanvas;
    }

    createVideoClone(video: HTMLVideoElement): HTMLImageElement {
        const canvas = video.ownerDocument.createElement('canvas');

        canvas.width = video.offsetWidth;
        canvas.height = video.offsetHeight;
        const ctx = canvas.getContext('2d');
        const image = new Image();
        // image.setAttribute('crossorigin', 'anonymous');

        try {
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                if (!this.options.allowTaint) {
                    ctx.getImageData(0, 0, canvas.width, canvas.height);
                }
                image.src = canvas.toDataURL('image/png');
            }
            return image;
        } catch (e) {
            this.context.logger.info(`Unable to clone video as it is tainted`, video);
        }

        const blankCanvas = video.ownerDocument.createElement('canvas');

        blankCanvas.width = video.offsetWidth;
        blankCanvas.height = video.offsetHeight;
        image.src = blankCanvas.toDataURL();
        return image;
    }

    appendChildNode(clone: HTMLElement | SVGElement, child: Node, copyStyles: boolean): void {
        if (
            !isElementNode(child) ||
            (!isScriptElement(child) &&
                !child.hasAttribute(IGNORE_ATTRIBUTE) &&
                (typeof this.options.ignoreElements !== 'function' || !this.options.ignoreElements(child)))
        ) {
            if (!this.options.copyStyles || !isElementNode(child) || !isStyleElement(child)) {
                clone.appendChild(this.cloneNode(child, copyStyles));
            }
        }
    }

    cloneChildNodes(node: Element, clone: HTMLElement | SVGElement, copyStyles: boolean): void {
        for (
            let child = node.shadowRoot ? node.shadowRoot.firstChild : node.firstChild;
            child;
            child = child.nextSibling
        ) {
            if (isElementNode(child) && isSlotElement(child) && typeof child.assignedNodes === 'function') {
                const assignedNodes = child.assignedNodes() as ChildNode[];
                if (assignedNodes.length) {
                    assignedNodes.forEach((assignedNode) => this.appendChildNode(clone, assignedNode, copyStyles));
                }
            } else {
                this.appendChildNode(clone, child, copyStyles);
            }
        }
    }

    adjustHeadFontStyle(clone: Node, node: HTMLElement | SVGElement): void {
        // body내 스타일을 적용합시다.
        if (!(clone instanceof HTMLElement)) return;

        const fontStyle = this.options.fontStyle;
        const isSameNode = node === this.referenceElement;

        if (isSameNode && fontStyle !== null && fontStyle !== undefined) {
            const styleNode = document.createElement('style');
            clone.appendChild(styleNode);
            styleNode.appendChild(document.createTextNode(fontStyle));
        }
    }

    cloneNode(node: Node, copyStyles: boolean): Node {
        if (isTextNode(node)) {
            return document.createTextNode(node.data);
        }

        if (!node.ownerDocument) {
            return node.cloneNode(false);
        }

        const window = node.ownerDocument.defaultView;

        if (window && isElementNode(node) && (isHTMLElementNode(node) || isSVGElementNode(node))) {
            const clone = this.createElementClone(node);

            // 폰트 적용하기
            this.adjustHeadFontStyle(clone, node);
            clone.style.transitionProperty = 'none';

            const style = window.getComputedStyle(node);
            const styleBefore = window.getComputedStyle(node, ':before');
            const styleAfter = window.getComputedStyle(node, ':after');

            if (isBodyElement(clone)) {
                createPseudoHideStyles(clone);
            }

            const counters = this.counters.parse(new CSSParsedCounterDeclaration(this.context, style));
            const before = this.resolvePseudoContent(node, clone, styleBefore, PseudoElementType.BEFORE);

            if (isCustomElement(node)) {
                copyStyles = true;
            }

            if (!isVideoElement(node)) {
                this.cloneChildNodes(node, clone, copyStyles);
            }

            if (before) {
                clone.insertBefore(before, clone.firstChild);
            }

            const after = this.resolvePseudoContent(node, clone, styleAfter, PseudoElementType.AFTER);
            if (after) {
                clone.appendChild(after);
            }

            this.counters.pop(counters);

            if (
                (style && (this.options.copyStyles || isSVGElementNode(node)) && !isIFrameElement(node)) ||
                copyStyles
            ) {
                copyCSSStyles(style, clone, this.options, this.context);
            }

            if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
                this.scrolledElements.push([clone, node.scrollLeft, node.scrollTop]);
            }

            // audio는 스크린샷 렌더링 하지 않도록 숨김 처리한다.
            if (isAudioElement(clone)) {
                clone.style.display = 'none';
            }

            if (this.referenceElement === node && isHTMLElementNode(clone)) {
                this.clonedReferenceElement = clone;
            }

            if (isInputElement(node) && isInputElement(clone)) {
                // 타입체크
                const type = node.type;
                switch (type) {
                    case 'submit':
                    case 'button':
                    case 'reset':
                    case 'hidden':
                        break;
                    case 'checkbox':
                    case 'radio':
                        // checked
                        node.checked ? clone.setAttribute('checked', '') : clone.removeAttribute('checked');
                        break;
                    default:
                        clone.setAttribute('value', node.value);
                }
            } else if (
                (isTextareaElement(node) || isSelectElement(node)) &&
                (isTextareaElement(clone) || isSelectElement(clone))
            ) {
                clone.value = node.value;
                if (isTextareaElement(node) && isTextareaElement(clone)) {
                    clone.innerHTML = clone.value;
                } else if (isSelectElement(node) && isSelectElement(clone)) {
                    // node.value은 option.value값을 찾아서 selected속성을 추가한다.
                    const value = clone.value;
                    const options = Array.from(clone.options) as Array<HTMLOptionElement>;
                    options.forEach((option) => {
                        if (option.value === value) {
                            option.setAttribute('selected', '');
                        } else {
                            option.removeAttribute('selected');
                        }
                    });
                }
            }

            return clone;
        }

        return node.cloneNode(false);
    }

    resolvePseudoContent(
        node: Element,
        clone: Element,
        style: CSSStyleDeclaration,
        pseudoElt: PseudoElementType
    ): HTMLElement | void {
        if (!style) {
            return;
        }

        const value = style.content;
        const document = clone.ownerDocument;
        if (!document || !value || value === 'none' || value === '-moz-alt-content' || style.display === 'none') {
            return;
        }

        this.counters.parse(new CSSParsedCounterDeclaration(this.context, style));
        const declaration = new CSSParsedPseudoDeclaration(this.context, style);

        const anonymousReplacedElement = document.createElement('html2canvaspseudoelement');
        copyCSSStyles(style, anonymousReplacedElement, this.options, this.context);

        declaration.content.forEach((token) => {
            if (token.type === TokenType.STRING_TOKEN) {
                anonymousReplacedElement.appendChild(document.createTextNode(token.value));
            } else if (token.type === TokenType.URL_TOKEN) {
                const img = document.createElement('img');
                img.src = token.value;
                img.style.opacity = '1';
                anonymousReplacedElement.appendChild(img);
            } else if (token.type === TokenType.FUNCTION) {
                if (token.name === 'attr') {
                    const attr = token.values.filter(isIdentToken);
                    if (attr.length) {
                        anonymousReplacedElement.appendChild(
                            document.createTextNode(node.getAttribute(attr[0].value) || '')
                        );
                    }
                } else if (token.name === 'counter') {
                    const [counter, counterStyle] = token.values.filter(nonFunctionArgSeparator);
                    if (counter && isIdentToken(counter)) {
                        const counterState = this.counters.getCounterValue(counter.value);
                        const counterType =
                            counterStyle && isIdentToken(counterStyle)
                                ? listStyleType.parse(this.context, counterStyle.value)
                                : LIST_STYLE_TYPE.DECIMAL;

                        anonymousReplacedElement.appendChild(
                            document.createTextNode(createCounterText(counterState, counterType, false))
                        );
                    }
                } else if (token.name === 'counters') {
                    const [counter, delim, counterStyle] = token.values.filter(nonFunctionArgSeparator);
                    if (counter && isIdentToken(counter)) {
                        const counterStates = this.counters.getCounterValues(counter.value);
                        const counterType =
                            counterStyle && isIdentToken(counterStyle)
                                ? listStyleType.parse(this.context, counterStyle.value)
                                : LIST_STYLE_TYPE.DECIMAL;
                        const separator = delim && delim.type === TokenType.STRING_TOKEN ? delim.value : '';
                        const text = counterStates
                            .map((value) => createCounterText(value, counterType, false))
                            .join(separator);

                        anonymousReplacedElement.appendChild(document.createTextNode(text));
                    }
                } else {
                    //   console.log('FUNCTION_TOKEN', token);
                }
            } else if (token.type === TokenType.IDENT_TOKEN) {
                switch (token.value) {
                    case 'open-quote':
                        anonymousReplacedElement.appendChild(
                            document.createTextNode(getQuote(declaration.quotes, this.quoteDepth++, true))
                        );
                        break;
                    case 'close-quote':
                        anonymousReplacedElement.appendChild(
                            document.createTextNode(getQuote(declaration.quotes, --this.quoteDepth, false))
                        );
                        break;
                    default:
                        // safari doesn't parse string tokens correctly because of lack of quotes
                        anonymousReplacedElement.appendChild(document.createTextNode(token.value));
                }
            }
        });

        anonymousReplacedElement.className = `${PSEUDO_HIDE_ELEMENT_CLASS_BEFORE} ${PSEUDO_HIDE_ELEMENT_CLASS_AFTER}`;
        const newClassName =
            pseudoElt === PseudoElementType.BEFORE
                ? ` ${PSEUDO_HIDE_ELEMENT_CLASS_BEFORE}`
                : ` ${PSEUDO_HIDE_ELEMENT_CLASS_AFTER}`;

        if (isSVGElementNode(clone)) {
            clone.className.baseValue += newClassName;
        } else {
            clone.className += newClassName;
        }

        return anonymousReplacedElement;
    }

    static destroy(container: HTMLIFrameElement): boolean {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
            return true;
        }
        return false;
    }
}

enum PseudoElementType {
    BEFORE,
    AFTER
}

const createIFrameContainer = (ownerDocument: Document, bounds: Bounds): HTMLIFrameElement => {
    const cloneIframeContainer = ownerDocument.createElement('iframe');

    cloneIframeContainer.className = 'html2canvas-container';
    cloneIframeContainer.style.visibility = 'hidden';
    cloneIframeContainer.style.position = 'fixed';
    cloneIframeContainer.style.left = '-10000px';
    cloneIframeContainer.style.top = '0px';
    cloneIframeContainer.style.border = '0';
    cloneIframeContainer.width = bounds.width.toString();
    cloneIframeContainer.height = bounds.height.toString();
    cloneIframeContainer.scrolling = 'no'; // ios won't scroll without it
    cloneIframeContainer.setAttribute(IGNORE_ATTRIBUTE, 'true');
    cloneIframeContainer.setAttribute('data-wsharing-skipmutation', 'true');
    ownerDocument.body.appendChild(cloneIframeContainer);

    return cloneIframeContainer;
};

const imageReady = (img: HTMLImageElement): Promise<Event | void | string> => {
    return new Promise((resolve) => {
        if (img.complete) {
            resolve();
            return;
        }
        if (!img.src) {
            resolve();
            return;
        }
        img.onload = resolve;
        img.onerror = resolve;
    });
};

const imagesReady = (document: HTMLDocument): Promise<unknown[]> => {
    return Promise.all([].slice.call(document.images, 0).map(imageReady));
};

const iframeLoader = (iframe: HTMLIFrameElement): Promise<HTMLIFrameElement> => {
    return new Promise((resolve, reject) => {
        const cloneWindow = iframe.contentWindow;

        if (!cloneWindow) {
            return reject(`No window assigned for iframe`);
        }

        const documentClone = cloneWindow.document;

        cloneWindow.onload = iframe.onload = () => {
            cloneWindow.onload = iframe.onload = null;
            const interval = setInterval(() => {
                if (documentClone.body.childNodes.length > 0 && documentClone.readyState === 'complete') {
                    clearInterval(interval);
                    resolve(iframe);
                }
            }, 50);
        };
    });
};

const ignoredStyleProperties = [
    'all', // #2476
    'd', // #2483
    'content' // Safari shows pseudoelements if content is set
];

const convertImageToBase64 = <T extends HTMLElement | SVGElement>(
    target: T,
    context: Context,
    style: CSSStyleDeclaration,
    options: CloneConfigurations
) => {
    if (!options.inlineImages) return;
    const urlRegExp = /url\(["']?(.*?)["']?\)/;
    // 만약 css background-image가 있다면?
    const url = style.backgroundImage.match(urlRegExp)?.[1];
    // 스타일 변경은 Element.style.setProperty(styleName, value) 형태로 지정할것.
    url &&
        context.cache.has(url) &&
        context.cache.match(url).then((img) => {
            // img.src는 base64로 되어있음.
            target.style.setProperty('background-image', `url(${img.src})`);
        });
};

export const copyCSSStyles = <T extends HTMLElement | SVGElement>(
    style: CSSStyleDeclaration,
    target: T,
    options: CloneConfigurations,
    context: Context
): T => {
    // Edge does not provide value for cssText
    for (let i = style.length - 1; i >= 0; i--) {
        const property = style.item(i);
        if (ignoredStyleProperties.indexOf(property) === -1) {
            switch (property) {
                case 'background-image':
                    // 기존 이미지 경로를 base64로 대체한다.
                    convertImageToBase64(target, context, style, options);
                    break;
                case 'background-position':
                    // background-position이 right 10px 50%일 경우 제대로 스타일 적용이 안됨.
                    target.style.setProperty('background-position-x', style.getPropertyValue('background-position-x'));
                    target.style.setProperty('background-position-y', style.getPropertyValue('background-position-y'));
                    break;
                default:
                    target.style.setProperty(property, style.getPropertyValue(property));
            }
        }
    }
    return target;
};

const serializeDoctype = (doctype?: DocumentType | null): string => {
    let str = '';
    if (doctype) {
        str += '<!DOCTYPE ';
        if (doctype.name) {
            str += doctype.name;
        }

        if (doctype.internalSubset) {
            str += doctype.internalSubset;
        }

        if (doctype.publicId) {
            str += `"${doctype.publicId}"`;
        }

        if (doctype.systemId) {
            str += `"${doctype.systemId}"`;
        }

        str += '>';
    }

    return str;
};

const restoreOwnerScroll = (ownerDocument: Document | null, x: number, y: number) => {
    if (
        ownerDocument &&
        ownerDocument.defaultView &&
        (x !== ownerDocument.defaultView.pageXOffset || y !== ownerDocument.defaultView.pageYOffset)
    ) {
        ownerDocument.defaultView.scrollTo(x, y);
    }
};

const restoreNodeScroll = ([element, x, y]: [HTMLElement, number, number]) => {
    element.scrollLeft = x;
    element.scrollTop = y;
};

const PSEUDO_BEFORE = ':before';
const PSEUDO_AFTER = ':after';
const PSEUDO_HIDE_ELEMENT_CLASS_BEFORE = '___html2canvas___pseudoelement_before';
const PSEUDO_HIDE_ELEMENT_CLASS_AFTER = '___html2canvas___pseudoelement_after';

const PSEUDO_HIDE_ELEMENT_STYLE = `{
    content: "" !important;
    display: none !important;
}`;

const createPseudoHideStyles = (body: HTMLElement) => {
    createStyles(
        body,
        `.${PSEUDO_HIDE_ELEMENT_CLASS_BEFORE}${PSEUDO_BEFORE}${PSEUDO_HIDE_ELEMENT_STYLE}
         .${PSEUDO_HIDE_ELEMENT_CLASS_AFTER}${PSEUDO_AFTER}${PSEUDO_HIDE_ELEMENT_STYLE}`
    );
};

const createStyles = (body: HTMLElement, styles: string) => {
    const document = body.ownerDocument;
    if (document) {
        const style = document.createElement('style');
        style.textContent = styles;
        body.appendChild(style);
    }
};
