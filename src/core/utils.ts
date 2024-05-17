export default class Utils {
    // ArrayLike<T>타입을 Array<T>으로 반환한다.
    static asArray<T>(arrayLike: ArrayLike<T>): Array<T> {
        // const array = [];
        // const length = arrayLike.length;
        // for (let i = 0; i < length; i++) array.push(arrayLike[i]);
        // return array;
        return Array.from(arrayLike);
    }
}
