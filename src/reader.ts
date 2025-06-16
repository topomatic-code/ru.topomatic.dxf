import xCode from "./codes";
import { Version } from "./version";

export declare interface CodePair {
    code: number;
    value: any;
}

export interface DxfReader {
    readonly drawing: Drawing;
    readonly line: number;
    readonly output: OutputChannel;
    version: Version;
    encoding: string;

    readVerify(code: number): any;
    read(): CodePair | undefined;
    pushBackItem(): void;
    atSubclassData(...cls: string[]): string;
}

export class DxfBaseReader implements DxfReader {
    public readonly output: OutputChannel;
    private readonly buffer: Uint8Array;
    private decoder: TextDecoder;
    private position = 0;
    private pushedBack = false;
    private pushedValue: CodePair = {
        code: 0,
        value: 0,
    }
    private _version = 0;
    private _encoding = 'CP1251';

    constructor(buffer: Uint8Array, drawing: Drawing, output: OutputChannel) {
        this.buffer = buffer;
        this.drawing = drawing;
        this.output = output;
        this.decoder = new TextDecoder(this._encoding);
    }

    public readonly drawing: Drawing;
    public line = 0;

    get version(): Version {
        return this._version;
    }

    set version(value: Version) {
        this._version = value;
        this.updateCodepage();
    }

    updateCodepage() {
        if (this.version >= Version.AC1021) {
            this.decoder = new TextDecoder('utf8');
        } else {
            this.decoder = new TextDecoder(this._encoding);
        }
    }

    get encoding(): string {
        return this._encoding;
    }

    set encoding(value: string) {
        this._encoding = value;
        this.updateCodepage();
    }

    public readVerify(code: number): any {
        const value = this.read();
        if (value?.code !== code) {
            throw new Error(`Expected code ${code}, got ${value?.code} at line ${this.line}`);
        }
        return value.value;
    }

    public read(): CodePair | undefined {
        if (this.pushedBack) {
            this.pushedBack = false;
            this.line += 2;
            return this.pushedValue;
        }
        const code = parseInt(this.readLine(), 10);
        const value = this.readLine();
        if (code === xCode.xcComment) {
            return this.read();
        }
        let type = xCodeType(code);
        if (code === xCode.xcControlString) {
            type = xVarEnum.XT_STRING;
        }
        this.pushedValue.code = code;
        switch (type) {
            case xVarEnum.XT_I1:
                if (value === '{') {
                    this.pushedValue.value = '{';
                } else if (value === '}') {
                    this.pushedValue.value = '}';
                } else {
                    this.pushedValue.value = parseInt(value, 10);
                }
                break;
            case xVarEnum.XT_I2:
                this.pushedValue.value = parseInt(value, 10);
                break;
            case xVarEnum.XT_I4:
                this.pushedValue.value = parseInt(value, 10);
                break;
            case xVarEnum.XT_I8:
                this.pushedValue.value = parseInt(value, 10);
                break;
            case xVarEnum.XT_HANDLE:
            case xVarEnum.XT_HARD_OWNER_ID:
            case xVarEnum.XT_SOFT_OWNER_ID:
            case xVarEnum.XT_HARD_POINTER_ID:
            case xVarEnum.XT_SOFT_POINTER_ID:
                this.pushedValue.value = value;
                break;
            case xVarEnum.XT_R8:
                this.pushedValue.value = parseFloat(value);
                break;
            case xVarEnum.XT_LPR8_3: {
                const v = [0, 0, 0];
                v[0] = parseFloat(value);
                if (parseInt(this.readLine(), 10) !== code + 10) {
                    throw new Error(`Unexpected code at line ${this.line}`);
                }
                v[1] = parseFloat(this.readLine());
                this.pushedValue.value = v;
                const p = this.position;
                if (parseInt(this.readLine(), 10) !== code + 20) {
                    this.line--;
                    this.position = p;
                } else {
                    v[2] = parseFloat(this.readLine());
                }
                break;
            }
            case xVarEnum.XT_BINARY: {
                const buf = this.readBinary(value);
                for (; ;) {
                    const p = this.position;
                    if (parseInt(this.readLine(), 10) !== code) {
                        this.line--;
                        this.position = p;
                        break;
                    } else {
                        buf.push(...this.readBinary(this.readLine()));
                    }
                }
                this.pushedValue.value = new Uint8Array(buf);
                break;
            }
            case xVarEnum.XT_STRING:
                this.pushedValue.value = value;
                break;

        }
        return this.pushedValue;
    }

    public pushBackItem() {
        if (!this.pushedBack) {
            this.pushedBack = true;
            this.line -= 2;
        }
    }

    public atSubclassData(...cls: string[]): string {
        const v = this.readVerify(xCode.xcStart);
        if (cls.length > 0) {
            let valid = false;
            for (let i = 0; i < cls.length; i++) {
                if (cls[i] === v.value) {
                    valid = true;
                    break;
                }
            }
            if (!valid) {
                throw new Error(`Unexpected subclass value \"${v.value}\" instead of \"${cls}\" at ${this.line}`);
            }
            return v.value;
        }
        return '';
    }

    private readLine(): string {
        let offset = this.position;
        let started = false;
        this.line++;
        while (this.position < this.buffer.length) {
            const chr = this.buffer[this.position];
            if (chr === 13) {
                const bin = new Uint8Array(this.buffer.buffer, offset, this.position - offset);
                this.position++;
                if ((this.position < this.buffer.length) && (this.buffer[this.position] === 10)) {
                    this.position++;
                }
                return this.decoder.decode(bin);
            } else if (chr === 10) {
                const bin = new Uint8Array(this.buffer.buffer, offset, this.position - offset);
                this.position++;
                return this.decoder.decode(bin);
            } else if ((chr === 32) && (!started)) {
                this.position++;
                offset = this.position;
            } else {
                started = true;
                this.position++;
            }
        }
        return this.decoder.decode(new Uint8Array(this.buffer.buffer, offset, this.position - offset));
    }

    private readBinary(value: string): number[] {
        const buf: number[] = [];
        for (let i = 0; i < value.length / 2; i++) {
            buf.push(parseInt(value[i * 2] + value[i * 2 + 1], 16));
        }
        return buf;
    }
}

export class DxfObjectReader implements DxfReader {
    private readonly reader: DxfReader;
    public subclasses: string[] | undefined = undefined;
    public isPaper = false;

    constructor(reader: DxfReader) {
        this.reader = reader;
    }

    get output(): OutputChannel {
        return this.reader.output;
    }

    get drawing(): Drawing {
        return this.reader.drawing;
    }

    get line(): number {
        return this.reader.line;
    }

    get version(): Version {
        return this.reader.version;
    }

    get encoding(): string {
        return this.reader.encoding;
    }

    readVerify(code: number) {
        return this.reader.readVerify(code);
    }

    read(): CodePair | undefined {
        if (this.subclasses === undefined) {
            const item = this.reader.read();
            if (!item) {
                throw new Error('Unexpected EOF');
            }
            switch (item.code) {
                case xCode.xcStart:
                case xCode.xcRegAppName:
                    this.reader.pushBackItem();
                    return undefined;
                default:
                    return item;
            }
        }
        while (true) {
            const item = this.reader.read();
            if (!item) {
                throw new Error('Unexpected EOF');
            }
            switch (item.code) {
                case xCode.xcSubclass:
                    if (this.validSubclass(item.value)) {
                        break;
                    } else {
                        this.reader.pushBackItem();
                        return undefined;
                    }
                case xCode.xcStart:
                    this.reader.pushBackItem();
                    return undefined;
                case xCode.xcRegAppName:
                    this.reader.pushBackItem();
                    return undefined;
                case 67:
                    this.isPaper = item.value === 1;
                    return item;
                default:
                    return item;
            }
        }
    }

    pushBackItem(): void {
        this.reader.pushBackItem();
    }

    public atSubclassData(...cls: string[]): string {
        this.subclasses = cls;
        if (this.reader.version > Version.AC1009) {
            if (cls !== undefined) {
                const item = this.reader.read();
                if (!item) {
                    this.reader.pushBackItem();
                } else if ((item.code !== xCode.xcSubclass) || (!this.validSubclass(item.value))) {
                    this.reader.pushBackItem();
                    throw Error(`Undefined subclass ${item.value}, required ${cls}`);
                }
                return item?.value ?? '';
            }
        }
        return '';
    }

    private validSubclass(value: string): boolean {
        if (!this.subclasses) {
            return true;
        }
        for (let i = 0; i < this.subclasses.length; i++) {
            if (this.subclasses[i] === value) {
                return true;
            }
        }
        return false;
    }
}

const enum xVarEnum {
    XT_EMPTY = 0,
    XT_I1 = 1,
    XT_I2 = 2,
    XT_I4 = 3,
    XT_I8 = 4,
    XT_HANDLE = 5,
    XT_HARD_OWNER_ID = 6,
    XT_SOFT_OWNER_ID = 7,
    XT_HARD_POINTER_ID = 8,
    XT_SOFT_POINTER_ID = 9,
    XT_R8 = 10,
    XT_LPR8_3 = 11,
    XT_BINARY = 12,
    XT_STRING = 13
};

function xCodeType(code: number): xVarEnum {
    switch (code) {
        case 38:
        case 39:
        case 40:
        case 41:
        case 42:
        case 43:
        case 44:
        case 45:
        case 46:
        case 47:
        case 48:
        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
        case 58:
        case 59:
        case 140:
        case 141:
        case 142:
        case 143:
        case 144:
        case 145:
        case 146:
        case 147:
        case 148:
        case 149:
        case 460:
        case 461:
        case 462:
        case 463:
        case 464:
        case 465:
        case 466:
        case 467:
        case 468:
        case 469:
        case 1040:
        case 1041:
        case 1042:
            return xVarEnum.XT_R8;
        case 90:
        case 91:
        case 92:
        case 93:
        case 94:
        case 95:
        case 96:
        case 97:
        case 98:
        case 99:
        case 420:
        case 421:
        case 422:
        case 423:
        case 424:
        case 425:
        case 426:
        case 427:
        case 428:
        case 429:
        case 440:
        case 441:
        case 442:
        case 443:
        case 444:
        case 445:
        case 446:
        case 447:
        case 448:
        case 449:
        case 450:
        case 451:
        case 452:
        case 453:
        case 454:
        case 455:
        case 456:
        case 457:
        case 458:
        case 459:
        case 1071:
            return xVarEnum.XT_I4;
        case 60:
        case 61:
        case 62:
        case 63:
        case 64:
        case 65:
        case 66:
        case 67:
        case 68:
        case 69:
        case 70:
        case 71:
        case 72:
        case 73:
        case 74:
        case 75:
        case 76:
        case 77:
        case 78:
        case 79:
        case 170:
        case 171:
        case 172:
        case 173:
        case 174:
        case 175:
        case 176:
        case 177:
        case 178:
        case 179:
        case 270:
        case 271:
        case 272:
        case 273:
        case 274:
        case 275:
        case 276:
        case 277:
        case 278:
        case 279:
        case 370:
        case 371:
        case 372:
        case 373:
        case 374:
        case 375:
        case 376:
        case 377:
        case 378:
        case 379:
        case 380:
        case 381:
        case 382:
        case 383:
        case 384:
        case 385:
        case 386:
        case 387:
        case 388:
        case 389:
        case 400:
        case 401:
        case 402:
        case 403:
        case 404:
        case 405:
        case 406:
        case 407:
        case 408:
        case 409:
        case 1070:
            return xVarEnum.XT_I2;
        case 280:
        case 281:
        case 282:
        case 283:
        case 284:
        case 285:
        case 286:
        case 287:
        case 288:
        case 289:
        case 290:
        case 291:
        case 292:
        case 293:
        case 294:
        case 295:
        case 296:
        case 297:
        case 298:
        case 299:
        case 1002:
            return xVarEnum.XT_I1;
        case -4:
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
        case 6:
        case 7:
        case 8:
        case 9:
        case 100:
        case 101:
        case 102:
        case 300:
        case 301:
        case 302:
        case 303:
        case 304:
        case 305:
        case 306:
        case 307:
        case 308:
        case 309:
        case 410:
        case 411:
        case 412:
        case 413:
        case 414:
        case 415:
        case 416:
        case 417:
        case 418:
        case 419:
        case 430:
        case 431:
        case 432:
        case 433:
        case 434:
        case 435:
        case 436:
        case 437:
        case 438:
        case 439:
        case 470:
        case 471:
        case 472:
        case 473:
        case 474:
        case 475:
        case 476:
        case 477:
        case 478:
        case 479:
        case 999:
        case 1000:
        case 1001:
        case 1003:
            return xVarEnum.XT_STRING;
        case 310:
        case 311:
        case 312:
        case 313:
        case 314:
        case 315:
        case 316:
        case 317:
        case 318:
        case 319:
        case 1004:
            return xVarEnum.XT_BINARY;
        case 5:
        case 105:
        case 320:
        case 321:
        case 322:
        case 323:
        case 324:
        case 325:
        case 326:
        case 327:
        case 328:
        case 329:
        case 1005:
            return xVarEnum.XT_HANDLE;
        case 360:
        case 361:
        case 362:
        case 363:
        case 364:
        case 365:
        case 366:
        case 367:
        case 368:
        case 369:
            return xVarEnum.XT_HARD_OWNER_ID;
        case 350:
        case 351:
        case 352:
        case 353:
        case 354:
        case 355:
        case 356:
        case 357:
        case 358:
        case 359:
            return xVarEnum.XT_SOFT_OWNER_ID;
        case -2:
        case 340:
        case 341:
        case 342:
        case 343:
        case 344:
        case 345:
        case 346:
        case 347:
        case 348:
        case 349:
        case 390:
        case 391:
        case 392:
        case 393:
        case 394:
        case 395:
        case 396:
        case 397:
        case 398:
        case 399:
            return xVarEnum.XT_HARD_POINTER_ID;
        case -1:
        case 330:
        case 331:
        case 332:
        case 333:
        case 334:
        case 335:
        case 336:
        case 337:
        case 338:
        case 339:
            return xVarEnum.XT_SOFT_POINTER_ID;
        case 10:
        case 11:
        case 12:
        case 13:
        case 14:
        case 15:
        case 16:
        case 17:
        case 110:
        case 111:
        case 112:
        case 210:
        case 211:
        case 212:
        case 213:
        case 214:
        case 215:
        case 216:
        case 217:
        case 218:
        case 219:
        case 1010:
        case 1011:
        case 1012:
        case 1013:
        case 1020:
        case 1021:
        case 1022:
        case 1023:
        case 1030:
        case 1031:
        case 1032:
        case 1033:
            return xVarEnum.XT_LPR8_3;
        case 160:
        case 161:
        case 162:
        case 163:
        case 164:
        case 165:
        case 166:
        case 167:
        case 168:
        case 169:
            return xVarEnum.XT_I8;
        default:
            return xVarEnum.XT_EMPTY;
    }
}
