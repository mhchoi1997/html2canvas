import { Context } from "../../core/context";
import { ElementContainer } from "../element-container";

export class VideoElementContainer extends ElementContainer {
    readonly src: string;
    intrinsicWidth: number;
    intrinsicHeight: number;

    constructor (context: Context, element: HTMLVideoElement) {
        super(context, element);
        this.src = element.currentSrc || element.src;
        this.intrinsicWidth = element.width;
        this.intrinsicHeight = element.height; 
        this.context.cache.addVideo(this.src, this.intrinsicWidth, this.intrinsicHeight);
    }
}