import {RenderConfigurations} from './canvas-renderer';
import {createForeignObjectSVG} from '../../core/features';
import {Renderer} from '../renderer';
import {Context} from '../../core/context';
import Utils from '../../core/utils';
import {asString} from '../../css/types/color';

export class ForeignObjectRenderer extends Renderer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    options: RenderConfigurations;

    constructor(context: Context, options: RenderConfigurations) {
        super(context, options);
        this.canvas = options.canvas ? options.canvas : document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
        this.options = options;
        this.canvas.width = Math.floor(options.width * options.scale);
        this.canvas.height = Math.floor(options.height * options.scale);
        this.canvas.style.width = `${options.width}px`;
        this.canvas.style.height = `${options.height}px`;

        this.ctx.scale(this.options.scale, this.options.scale);
        this.ctx.translate(-options.x, -options.y);
        this.context.logger.debug(
            `EXPERIMENTAL ForeignObject renderer initialized (${options.width}x${options.height} at ${options.x},${options.y}) with scale ${options.scale}`
        );
    }

    async render(element: HTMLElement): Promise<HTMLCanvasElement> {
        return new Promise((resolve) => {
            const svg = createForeignObjectSVG(
                this.options.width * this.options.scale,
                this.options.height * this.options.scale,
                this.options.scale,
                this.options.scale,
                element
            );

            const svgString = new XMLSerializer().serializeToString(svg);
            const svgBlob = new Blob([svgString], {
                type: 'image/svg+xml;charset=utf-8'
            });

            const imgUrl = URL.createObjectURL(svgBlob);

            Utils.getAndEncode(imgUrl)
                .then((content: string) => {
                    return Utils.dataAsUrl(content, 'image/svg+xml');
                })
                .then((dataUrl: string) => {
                    const image = new Image();
                    image.src = dataUrl;
                    image.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;

                        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

                        if (this.options.backgroundColor) {
                            ctx.fillStyle = asString(this.options.backgroundColor);
                            ctx.fillRect(
                                0,
                                0,
                                this.options.width * this.options.scale,
                                this.options.height * this.options.scale
                            );
                        }

                        ctx?.drawImage(image, 0, 0);

                        resolve(canvas);
                    };
                })
                .finally(() => {
                    this.context.logger.debug('메모리 누수 방지를 위한 revorkObjectURL 호출');
                    URL.revokeObjectURL(imgUrl); // createObjectURL으로 생성한 object url을 해제한다.
                });
        });
    }
}
