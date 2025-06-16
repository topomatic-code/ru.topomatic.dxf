import { DwgType, LinetypeElement, TextAlignment } from "albatros/enums";
import xCode from "./codes";
import Encodings from "./encoding";
import { CodePair, DxfObjectReader, DxfReader } from "./reader";
import { Version, VersionMap } from "./version";

declare interface DxfObject {
    handle: string;
    owner: string;
    xdata: Record<string, CodePair[]>
    xdict: string[];
}

declare interface DxfEntity {
    entity: Partial<DwgEntityData & { $paper?: boolean }>;
    subset?: DxfEntity[];
    $cls: string;
    dxf: DxfObject;
}

declare interface DxfVertexData extends DwgEntityData {
    type: string;
    position: vec3;
    startWidth: number;
    endWidth: number;
    flags: number;
    bulge: number;
    angle: number;
    identifier: number;
}

declare interface DxfPolylineData extends DwgEntityData {
    type: string;
    hasSubset: boolean;
    thickness: number;
    position: vec3;
    startWidth: number;
    endWidth: number;
    typeFlags: number;
    flags: number;
    normal: vec3;
}

function skepSection(reader: DxfReader) {
    for (; ;) {
        const value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ("ENDSEC" === value.value)) {
            break;
        }
    }
}

function skepTable(reader: DxfReader) {
    for (; ;) {
        const value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ("ENDTAB" === value.value)) {
            break;
        }
    }
}

function readEod(reader: DxfReader): CodePair[] {
    let braces = 0;
    const xdata: CodePair[] = [];
    for (; ;) {
        let item = reader.read();
        if (!item) {
            break;
        }
        if ((item.code === xCode.xcRegAppName) || (item.code === xCode.xcStart)) {
            reader.pushBackItem();
            break;
        }
        item = {
            code: item.code,
            value: item.value,
        }
        switch (item.code) {
            case xCode.xcXdAsciiString:
                xdata.push(item);
                break;
            case xCode.xcXdControlString:
                if (item.value === '{') {
                    braces++;
                } else if (item.value === '}') {
                    braces--;
                } else {
                    throw new Error('XDATA 1002 An extended data control string can be either “{”or “}”.');
                }
                xdata.push(item);
            case xCode.xcXdLayerName:
                xdata.push(item);
                break;
            case xCode.xcXdBinaryChunk:
                xdata.push(item);
                break;
            case xCode.xcXdHandle:
                xdata.push(item);
                break;
            case xCode.xcXdXCoord:
            case xCode.xcXdWorldXCoord:
            case xCode.xcXdWorldXDisp:
            case xCode.xcXdWorldXDir:
                xdata.push(item);
                break;
            case xCode.xcXdXCoord + 10:
            case xCode.xcXdWorldXCoord + 10:
            case xCode.xcXdWorldXDisp + 10:
            case xCode.xcXdWorldXDir + 10:
                xdata.push(item);
                break;
            case xCode.xcXdReal:
            case xCode.xcXdDist:
            case xCode.xcXdScale:
                xdata.push(item);
                break;
            case xCode.xcXdInteger16:
                xdata.push(item);
                break;
            case xCode.xcXdInteger32:
                xdata.push(item);
                break;
            default:
                throw new Error(`XDATA ${item.code} Unexpected code at line ${reader.line - 1}`);
        }
    }
    if (braces != 0) {
        throw new Error('XDATA 1002 brackets are not balanced.');
    }
    return xdata;
}

function readAcDbObject<T>(loader: DxfLoader, reader: DxfReader, obj: T, dxfin?: (loader: DxfLoader, reader: DxfReader, obj: T) => void): DxfObject {
    const r = new DxfObjectReader(reader);
    const dxf: DxfObject = {
        handle: '',
        owner: '',
        xdata: {},
        xdict: []
    };
    let flags = 0;
    for (; ;) {
        let item = reader.read();
        if (!item) {
            break;
        }
        if (item.code === xCode.xcStart) {
            reader.pushBackItem();
            break;
        }
        switch (item.code) {
            case xCode.xcHandle:
            case xCode.xcDimVarHandle:
                flags |= 0x1;
                dxf.handle = item.value;
                break;
            case xCode.xcControlString:
                if (item.value === "{ACAD_XDICTIONARY") {
                    const xdict = reader.readVerify(xCode.xcHardOwnershipId);
                    if ((flags & 0x1) === 0x1) {
                        dxf.xdict.push(xdict);
                    }
                    flags |= 0x2;
                }
                for (; ;) {
                    item = reader.read();
                    if (item?.code === xCode.xcHardOwnershipId) {
                        if ((flags & 0x1) === 0x1) {
                            dxf.xdict.push(item.value);
                        }
                    }
                    if ((item?.code === xCode.xcControlString) && (item.value === '}')) {
                        break;
                    }
                }
                break;
            case xCode.xcSoftPointerId:
                dxf.owner = item.value;
                flags |= 0x4;
                break;
            case xCode.xcSubclass:
                if ((flags & 0x8) == 0) {
                    if (dxfin) {
                        reader.pushBackItem();
                        dxfin(loader, r, obj);
                    } else {
                        throw new Error(`Unexpected class "${item.value}" at line ${reader.line - 1}`);
                    }
                    flags |= 0x8;
                } else {
                    throw new Error(`Unexpected class "${item.value}" at line ${reader.line - 1}`);
                }
                break;
            case xCode.xcRegAppName: {
                let xdata: Record<string, CodePair[]> = {};
                reader.pushBackItem();
                for (; ;) {
                    item = reader.read();
                    if (item?.code === xCode.xcStart) {
                        reader.pushBackItem();
                        break;
                    }
                    switch (item?.code) {
                        case xCode.xcRegAppName:
                            xdata[item.value] = readEod(reader);
                            break;
                        default:
                            throw new Error(`XDATA ${item?.code} Unexpected code`);
                    }
                }
                flags |= 0x10;
                if ((flags & 0x1) === 0x1) {
                    dxf.xdata = xdata;
                }
                break;
            }
            default:
                if (reader.version <= Version.AC1009) {
                    if (dxfin) {
                        reader.pushBackItem();
                        dxfin(loader, r, obj);
                    } else {
                        throw new Error(`Unexpected class "${item.value}" at line ${reader.line - 1}`);
                    }
                    flags |= 0x8;
                } else {
                    reader.output.warn('Unexpected code "{0}" at line {1}', item.code, reader.line - 1);
                }
                break;
        }
    }
    return dxf;
}

function readTable(_loader: DxfLoader, reader: DxfReader) {
    reader.atSubclassData("AcDbSymbolTable");
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcInt16: // Size
                break;
            default:
                reader.output.warn('Unexpected code "{0}" at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readTableRecord(reader: DxfReader) {
    if (reader.version > Version.AC1009) {
        reader.atSubclassData("AcDbSymbolTableRecord");
        for (; ;) {
            const item = reader.read();
            if (!item) {
                break;
            }
            switch (item.code) {
                default:
                    reader.output.warn('Unexpected code "{0}" at line {1}', item.code, reader.line - 1);
                    break;
            }
        }
    }
}

async function readLinetype(_loader: DxfLoader, reader: DxfReader, data: DwgLinetypeData) {
    readTableRecord(reader);
    reader.atSubclassData("AcDbLinetypeTableRecord");
    let flags = 0;
    let numDashes = 0;
    for (; ;) {
        let item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcSymTableRecName:
                data.name = item.value;
                flags |= 0x1;
                break;
            case xCode.xcInt16:
            case xCode.xcLinetypeAlign:
                break;
            case xCode.xcDescription:
                data.description = item.value;
                break;
            case xCode.xcLinetypePDC:
                numDashes = item.value;
                flags |= 0x2;
                break;
            case xCode.xcReal: // pattern length
                flags |= 0x4;
                break;
            case xCode.xcDashLength:
                if ((flags & 0x2) != 0x2) {
                    throw new Error('Pattern size not defined');
                }
                data.pattern = [];
                reader.pushBackItem();
                for (let i = 0; i < numDashes; i++) {
                    const length = reader.readVerify(xCode.xcDashLength);
                    const p: Linetype = {
                        length,
                    };
                    let shapeFlag = 0;
                    item = reader.read();
                    if (item?.code === xCode.xcLinetypeElementType) {
                        shapeFlag = item.value;
                    } else {
                        reader.pushBackItem();
                    }
                    if (shapeFlag !== 0) {
                        p.type = LinetypeElement.Simple;
                        if ((shapeFlag & 0x1) == 0x1) {
                            p.type != LinetypeElement.Absolute;
                        }
                        if ((shapeFlag & 0x2) == 0x2) {
                            p.type |= LinetypeElement.Text;
                        }
                        if ((shapeFlag & 0x4) == 0x4) {
                            p.type |= LinetypeElement.Shape;
                        }
                    }
                    item = reader.read();
                    if (item?.code === 75) {
                        p.shapeNumber = item.value;
                    } else {
                        reader.pushBackItem();
                    }
                    item = reader.read();
                    if (item?.code === xCode.xcHardPointerId) {
                        p.$style = undefined; // TODO
                    } else {
                        reader.pushBackItem();
                    }
                    item = reader.read();
                    if (item?.code === xCode.xcShapeScale) {
                        p.scale = item.value;
                    } else {
                        reader.pushBackItem();
                    }
                    item = reader.read();
                    if (item?.code === xCode.xcAngle) {
                        p.rotation = item.value;
                    } else {
                        reader.pushBackItem();
                    }
                    item = reader.read();
                    if (item?.code === xCode.xcShapeXOffset) {
                        p.offset = [item.value, 0];
                    } else {
                        reader.pushBackItem();
                    }
                    item = reader.read();
                    if (item?.code === xCode.xcShapeYOffset) {
                        if (!p.offset) {
                            p.offset = [0, 0];
                        }
                        p.offset[1] = item.value;
                    } else {
                        reader.pushBackItem();
                    }
                    item = reader.read();
                    if (item?.code === xCode.xcCLShapeText) {
                        p.s = item.value;
                    } else {
                        reader.pushBackItem();
                    }
                    data.pattern.push(p);
                }
                break;
            default:
                reader.output.warn('AcDbLinetypeTableRecord code "{0}", value "{1}"', item.code, item.value);
                break;
        }
    }
}

async function readLinetypes(loader: DxfLoader, reader: DxfReader) {
    await readAcDbObject(loader, reader, reader.drawing.linetypes, readTable);
    for (; ;) {
        const name = reader.readVerify(xCode.xcStart);
        if (name === 'ENDTAB') {
            break;
        }
        if (name !== 'LTYPE') {
            throw new Error(`Expected value "LTYPE", got "${name}" at line ${reader.line}`);
        }
        const data: DwgLinetypeData = {};
        readAcDbObject(loader, reader, data, readLinetype);
        if (data.name !== undefined) {
            if (data.name.toUpperCase() === 'CONTINUOUS') {
                loader.linetypes[data.name] = reader.drawing.linetypes.continuous!;
            } else if (data.name.toUpperCase() === 'BYLAYER') {
                loader.linetypes[data.name] = reader.drawing.linetypes.bylayer!;
            } else if (data.name.toUpperCase() === 'BYBLOCK') {
                loader.linetypes[data.name] = reader.drawing.linetypes.byblock!;
            } else {
                loader.linetypes[data.name] = await reader.drawing.linetypes.add(data);
            }
        }
    }
}

function readLayer(loader: DxfLoader, reader: DxfReader, data: Partial<DwgLayerData>) {
    readTableRecord(reader);
    reader.atSubclassData("AcDbLayerTableRecord");
    let flags = 0;
    for (; ;) {
        let item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcSymTableRecName:
                data.name = item.value;
                flags |= 0x1;
                break;
            case xCode.xcDescription:
                data.description = item.value;
                break;
            case xCode.xcInt16:
                data.hidden = (item.value & 0x1) === 0x1;
                data.disabled = (item.value & 0x4) === 0x4;
                flags |= 0x2;
                break;
            case xCode.xcColor:
                if (item.value < 0) {
                    data.hidden = true;
                    data.color = -item.value;
                } else {
                    data.hidden = false;
                    data.color = item.value;
                }
                flags |= 0x4;
                break;
            case xCode.xcColorRGB:
                data.color = item.value | (0xff << 24);
                flags |= 0x4;
                break;
            case xCode.xcColorName:
                break;
            case xCode.xcLinetypeName:
                // @ts-ignore
                data.$linetype = loader.linetypes[item.value];
                flags |= 0x8;
                break;
            case xCode.xcBool:
                data.unplottable = item.value === 0
                flags |= 0x10;
                break;
            case xCode.xcLineWeight:
                data.lineweight = item.value;
                flags |= 0x20;
                break;
            case xCode.xcMaterialId:
                // data.$material = item.value;
                flags |= 0x40;
                break;
            case xCode.xcVisualStyleId:
                // data.visualstyle = item.value;
                flags |= 0x80;
                break;
            case xCode.xcPlotStyleNameId:
                break;
            default:
                reader.output.warn('AcDbLayerTableRecord code "{0}", value "{1}"', item.code, item.value);
                break;
        }
    }
}

async function readLayers(loader: DxfLoader, reader: DxfReader) {
    readAcDbObject(loader, reader, reader.drawing.layers, readTable);
    for (; ;) {
        const name = reader.readVerify(xCode.xcStart);
        if (name === 'ENDTAB') {
            break;
        }
        if (name !== 'LAYER') {
            throw new Error(`Expected value "LAYER", got "${name}" at line ${reader.line}`);
        }
        const data: Partial<DwgLayerData> = {};
        readAcDbObject(loader, reader, data, readLayer);
        if (data.name !== undefined) {
            if (data.name === '0') {
                loader.layers[data.name] = reader.drawing.layers.layer0!;
            } else {
                loader.layers[data.name] = await reader.drawing.layers.add(data);
            }
        }
    }
}

function readStyle(_loader: DxfLoader, reader: DxfReader, data: Partial<DwgTextStyleData>) {
    readTableRecord(reader);
    reader.atSubclassData("AcDbTextStyleTableRecord");
    let flags = 0;
    for (; ;) {
        let item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcSymTableRecName:
                data.name = item.value;
                flags |= 0x1;
                break;
            case xCode.xcInt16:
                // shape 0x1
                // vertical 0x4
                break;
            case xCode.xcReal:
                data.height = item.value;
                break;
            case xCode.xcTxtStyleXScale:
                data.ratio = item.value;
                break;
            case xCode.xcAngle:
                data.oblique = item.value * Math.PI / 180.0;
                break;
            case xCode.xcTxtStyleFlags:
                data.flags = item.value;
                // Backward 0x2
                // UpsideDown 0x4
                break;
            case xCode.xcTxtStylePSize:
                // last used size
                break;
            case xCode.xcTextFontFile:
                data.filename = item.value;
                break;
            case xCode.xcTextBigFontFile:
                break;
            case xCode.xcXdInteger32:
                break;
            default:
                reader.output.warn('AcDbTextStyleTableRecord code "{0}", value "{1}"', item.code, item.value);
                break;
        }
    }
}

async function readStyles(loader: DxfLoader, reader: DxfReader) {
    readAcDbObject(loader, reader, reader.drawing.styles, readTable);
    for (; ;) {
        const name = reader.readVerify(xCode.xcStart);
        if (name === 'ENDTAB') {
            break;
        }
        if (name !== 'STYLE') {
            throw new Error(`Expected value "STYLE", got "${name}" at line ${reader.line}`);
        }
        const data: Partial<DwgTextStyleData> = {};
        readAcDbObject(loader, reader, data, readStyle);
        if (data.name !== undefined) {
            if (data.name.toUpperCase() === 'STANDARD') {
                loader.styles[data.name] = reader.drawing.styles.standard!;
            } else {
                loader.styles[data.name] = await reader.drawing.styles.add(data);
            }
        }
    }
}

function readBlockRecord(_loader: DxfLoader, reader: DxfReader, data: DwgBlockData) {
    readTableRecord(reader);
    reader.atSubclassData("AcDbBlockTableRecord");
    let flags = 0;
    for (; ;) {
        let item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcSymTableRecName:
                data.name = item.value;
                flags |= 0x1;
                break;
            case xCode.xcHardPointerId:
                // layout
                break;
            case xCode.xcInt16:
                // units
                break;
            case xCode.xcInt8:
                // explodable
                break;
            case xCode.xcInt8 + 1:
                // scaling mode
                break;
            case xCode.xcBinaryChunk:
                break;
            case xCode.xcControlString:
                if (item.value === "{BLKREFS") {
                    for (; ;) {
                        item = reader.read();
                        if (!item) {
                            break;
                        }
                        if (item.code === 102) {
                            console.assert(item.value === '}');
                            break;
                        } else {
                            console.assert(item.code === 331 || item.code === 332);
                        }
                    }
                }
                break;
            default:
                reader.output.warn('AcDbBlockTableRecord code "{0}", value "{1}"', item.code, item.value);
                break;
        }
    }
}

async function readBlockRecords(loader: DxfLoader, reader: DxfReader) {
    readAcDbObject(loader, reader, reader.drawing.blocks, readTable);
    for (; ;) {
        const name = reader.readVerify(xCode.xcStart);
        if (name === 'ENDTAB') {
            break;
        }
        if (name !== 'BLOCK_RECORD') {
            throw new Error(`Expected value "BLOCK_RECORD", got "${name}" at line ${reader.line}`);
        }
        const data: DwgBlockData = {};
        const dxf = readAcDbObject(loader, reader, data, readBlockRecord);
        if (data.name) {
            if (data.name.toUpperCase() === '*MODEL_SPACE') {
                loader.layouts[dxf.handle] = reader.drawing.layouts.model;
            } else if (data.name.toUpperCase().startsWith('*PAPER_SPACE')) {
                loader.layouts[dxf.handle] = await reader.drawing.layouts.add({
                    name: data.name,
                });
            } else {
                loader.blocks[data.name] = await reader.drawing.blocks.add(data);
            }
        }
    }
}

function readDxfHeader(loader: DxfLoader, reader: DxfReader) {
    for (; ;) {
        const value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ("ENDSEC" === value.value)) {
            break;
        } else if (value.code !== xCode.xcCLShapeText) {
            throw new Error(`Expected code ${xCode.xcCLShapeText}, got ${value.code} at line ${reader.line - 1}`);
        }
        const name = value.value;
        loader.variables[name] = reader.read()?.value;
        switch (name) {
            case '$ACADVER': {
                const version = VersionMap[loader.variables[name]];
                if (!version) {
                    throw new Error(`Unsupported dxf version "${loader.variables[name]}"`);
                }
                reader.version = version;
                break;
            }
            case '$DWGCODEPAGE': {
                const cp = loader.variables[name];
                for (let i = 0; i < Encodings.length; i++) {
                    if (cp === Encodings[i].name) {
                        reader.encoding = Encodings[i].encoding;
                        break;
                    }
                }
            }
        }
    }
}

function readDxfClasses(loader: DxfLoader, reader: DxfReader) {
    for (; ;) {
        const value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ("ENDSEC" === value.value)) {
            break;
        } else if (value.value !== 'CLASS') {
            throw new Error(`Expected CLASS, got ${value.value} at line ${reader.line - 1}`);
        }
        let f = 0;
        let dxf = '';
        let cpp = '';
        let app = '';
        let flags = 0;
        let instances = 0;
        let zombie = false;
        let entity = false;
        for (; ;) {
            const value = reader.read();
            if (!value) {
                break;
            }
            if (value.code === xCode.xcStart) {
                reader.pushBackItem();
                break;
            }
            switch (value.code) {
                case xCode.xcStart + 1:
                    dxf = value.value;
                    f |= 0x1;
                    break;
                case xCode.xcStart + 2:
                    cpp = value.value;
                    f |= 0x2;
                    break;
                case xCode.xcStart + 3:
                    app = value.value;
                    f |= 0x4;
                    break;
                case xCode.xcInt32:
                    flags = value.value;
                    f |= 0x8;
                    break;
                case xCode.xcInt32 + 1:
                    instances = value.value;
                    f |= 0x10;
                    break;
                case xCode.xcInt8:
                    zombie = value.value;
                    f |= 0x20;
                    break;
                case xCode.xcInt8 + 1:
                    entity = value.value;
                    f |= 0x40;
                    break;
                default:
                    reader.output.warn('Unexpected code {0} at line {1}', value.code, reader.line - 1);
                    break;
            }
        }
        if ((f & 0x1) == 0) {
            throw new Error("Class dxf name is not defined");
        }
        if ((f & 0x2) == 0) {
            throw new Error("Class cpp name is not defined");
        }
        if ((f & 0x4) == 0) {
            throw new Error("Class application name is not defined");
        }
        if ((f & 0x8) == 0) {
            throw new Error("Class flags is not defined");
        }
        if ((f & 0x40) == 0) {
            throw new Error("Class object type is not defined");
        }
        loader.classes[dxf] = {
            dxf,
            cpp,
            app,
            flags,
            instances,
            zombie,
            entity,
        }
    }
}

async function readDxfTables(loader: DxfLoader, reader: DxfReader) {
    let flags = 0;
    for (; ;) {
        const value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ("ENDSEC" === value.value)) {
            break;
        } else if (value.value !== 'TABLE') {
            throw new Error(`Expected TABLE, got ${value.value} at line ${reader.line - 1}`);
        }
        const tableType = reader.readVerify(xCode.xcSymbolTableName);
        switch (tableType) {
            case 'STYLE':
                if ((flags & 0x1) == 0x1) {
                    throw new Error("LTYPE table duplicated");
                }
                await readStyles(loader, reader);
                flags |= 0x1;
                break;
            case 'LTYPE':
                if ((flags & 0x2) == 0x2) {
                    throw new Error("LTYPE table duplicated");
                }
                await readLinetypes(loader, reader);
                flags |= 0x2;
                break;
            case 'LAYER':
                if ((flags & 0x2) == 0) {
                    throw new Error("LTYPE table is not found before LAYER");
                }
                if ((flags & 0x4) == 0x4) {
                    throw new Error("LAYER table duplicated");
                }
                await readLayers(loader, reader);
                flags |= 0x4;
                break;
            case 'BLOCK_RECORD':
                if ((flags & 0x8) == 0x8) {
                    throw new Error("BLOCK_RECORD table duplicated");
                }
                await readBlockRecords(loader, reader);
                flags |= 0x8;
                break;
            default:
                skepTable(reader);
                break;
        }
    }
}

function skepEntity(reader: DxfReader) {
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        if (item.code === xCode.xcStart) {
            reader.pushBackItem();
            break;
        }
    }
}

function readDxfEntity(loader: DxfLoader, reader: DxfReader, entity?: Partial<DwgEntityData & { $paper?: boolean }>) {
    reader.atSubclassData('AcDbEntity');
    let eof = false;
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcHandle:
            case xCode.xcDimVarHandle:
                break;
            case xCode.xcLayerName:
                if (entity) {
                    entity.layer = loader.layers[item.value];
                }
                break;
            case xCode.xcLinetypeName:
                if (entity) {
                    entity.linetype = loader.linetypes[item.value];
                }
                break;
            case xCode.xcMaterialId:
                break;
            case xCode.xcColor:
                if (entity) {
                    entity.color = item.value;
                }
                break;
            case xCode.xcLineWeight:
                if (entity) {
                    entity.lineweight = item.value;
                }
                break;
            case xCode.xcLinetypeScale:
                if (entity) {
                    entity.ltscale = item.value;
                }
                break;
            case xCode.xcVisibility:
                break;
            case xCode.xcInt32 + 2: // Number of bytes in the proxy entity graphics
                break;
            case xCode.xcBinaryChunk:
                break;
            case xCode.xcColorRGB:
                if (entity) {
                    entity.color = item.value | (0xff << 24);
                }
                break;
            case xCode.xcColorName:
                break;
            case xCode.xcAlpha:
                if ((item.value & 0x1000000) == 0x1000000) {
                    // by block
                } else if ((item.value & 0x2000000) == 0x2000000) {
                    // item.value & 0xff
                } else {
                    // by layer
                }
                break;
            case xCode.xcPlotStyleNameId:
                break;
            case xCode.xcVisualStyleId:
            case xCode.xcPlotStyleNameType:
                break;
            case xCode.xcShadowFlags:
                break;
            case 67: // Absent or zero indicates entity is in model space.
                if (item.value !== 0) {
                    if (entity) {
                        entity.$paper = true;
                    }
                }
                break;
            case xCode.xcInt64:
                break;
            default:
                if (reader.version <= Version.AC1009) {
                    reader.pushBackItem();
                    eof = true;
                } else {
                    reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                }
                break;
        }
        if (eof) {
            break;
        }
    }
}

function readDxfLine(loader: DxfLoader, reader: DxfReader, line: Partial<DwgLineData>) {
    readDxfEntity(loader, reader, line);
    reader.atSubclassData('AcDbLine');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcThickness:
                // line.thickness = item.value;
                break;
            case xCode.xcXCoord:
                line.a = item.value;
                break;
            case xCode.xcXCoord + 1:
                line.b = item.value;
                break;
            case xCode.xcNormalX:
                // line.normal = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readDxfCircle(loader: DxfLoader, reader: DxfReader, circle: Partial<DwgCircleData>) {
    readDxfEntity(loader, reader, circle);
    reader.atSubclassData('AcDbCircle');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcThickness:
                // circle.thickness = item.value;
                break;
            case xCode.xcXCoord:
                circle.center = item.value;
                break;
            case xCode.xcReal:
                circle.radius = item.value;
                break;
            case xCode.xcNormalX:
                // circle.normal = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readDxfArc(loader: DxfLoader, reader: DxfReader, arc: Partial<DwgArcData>) {
    readDxfEntity(loader, reader, arc);
    reader.atSubclassData('AcDbCircle');
    let eof = false;
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcThickness:
                // arc.thickness = item.value;
                break;
            case xCode.xcXCoord:
                arc.center = item.value;
                break;
            case xCode.xcReal:
                arc.radius = item.value;
                break;
            case xCode.xcNormalX:
                // arc.normal = item.value;
                break;
            default:
                if (reader.version <= Version.AC1009) {
                    reader.pushBackItem();
                    eof = true;
                } else {
                    reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                }
                break;
        }
        if (eof) {
            break;
        }
    }
    reader.atSubclassData('AcDbArc');
    let endAngle = 0.0;
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcAngle:
                arc.angle = item.value * Math.PI / 180.0;
                break;
            case xCode.xcAngle + 1:
                endAngle = item.value * Math.PI / 180.0;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
    arc.span = endAngle - (arc.angle ?? 0.0);
    if (arc.span < 0.0) {
        arc.span += 2 * Math.PI;
    }
}

function readDxfLwPolyline(loader: DxfLoader, reader: DxfReader, polyline: Partial<DwgPolylineData>) {
    readDxfEntity(loader, reader, polyline);
    reader.atSubclassData('AcDbPolyline');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcInt32: // count
                break;
            case xCode.xcInt16:
                if (item.value) {
                    polyline.flags = item.value;
                }
                break;
            case xCode.xcReal + 3:
                if (item.value !== 0.0) {
                    polyline.width = item.value;
                }
                break;
            case xCode.xcElevation:
                polyline.elevation = item.value;
                break;
            case xCode.xcThickness:
                // polyline.thickness = item.value;
                break;
            case xCode.xcXCoord:
                if (!polyline.vertices) {
                    polyline.vertices = [];
                }
                polyline.vertices.push(item.value);
                break;
            case xCode.xcVertexIdentifier:
                break;
            case xCode.xcReal:
                // start width
                break;
            case xCode.xcReal + 1:
                // end width
                break;
            case xCode.xcReal + 2:
                if (!polyline.vertices) {
                    break;
                }
                polyline.vertices[polyline.vertices.length - 1][2] = item.value;
                break;
            case xCode.xcNormalX:
                // polyline.normal = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readDxfText(loader: DxfLoader, reader: DxfReader, text: Partial<DwgTextData>) {
    readDxfEntity(loader, reader, text);
    reader.atSubclassData('AcDbText');
    let eof = false;
    let valign = 0;
    let halign = 0;
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcThickness:
                // text.thickness = item.value;
                break;
            case xCode.xcXCoord:
                text.position = item.value;
                break;
            case xCode.xcTxtSize:
                text.height = item.value;
                break;
            case xCode.xcText:
                text.content = item.value;
                break;
            case xCode.xcAngle:
                text.rotation = item.value * Math.PI / 180.0;
                break;
            case xCode.xcTxtStyleXScale:
                text.ratio = item.value;
                break;
            case xCode.xcTxtOblique:
                text.oblique = item.value * Math.PI / 180.0;
                break;
            case xCode.xcTextStyleName:
                text.style = loader.styles[item.value];
                break;
            case xCode.xcTxtStyleFlags:
                // text.generation = item.value;
                break;
            case xCode.xcTxtStyleFlags + 1:
                halign = item.value;
                break;
            case xCode.xcTxtStyleFlags + 2:
                valign = item.value;
                break;
            case xCode.xcXCoord + 1:
                // align = item.value;
                break;
            case xCode.xcNormalX:
                // text.normal = item.value;
                break;
            default:
                if (reader.version <= Version.AC1009) {
                    reader.pushBackItem();
                    eof = true;
                } else {
                    reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                }
                break;
        }
        if (eof) {
            break;
        }
    }
    let justify: TextAlignment;
    switch (valign) {
        case 0:
            switch (halign) {
                case 0:
                    justify = TextAlignment.Left;
                    break;
                case 1:
                    justify = TextAlignment.Center;
                    break;
                case 2:
                    justify = TextAlignment.Right;
                    break;
                case 3:
                    justify = TextAlignment.Aligned;
                    break;
                case 4:
                    justify = TextAlignment.Middle;
                    break;
                case 5:
                    justify = TextAlignment.Fit;
                    break;
                default:
                    reader.output.warn('text align undefined');
                    justify = TextAlignment.Left;
                    break;
            }
            break;
        case 1:
            switch (halign) {
                case 0:
                    justify = TextAlignment.BottomLeft;
                    break;
                case 1:
                    justify = TextAlignment.BottomCenter;
                    break;
                case 2:
                    justify = TextAlignment.BottomRight;
                    break;
                default:
                    reader.output.warn('text align undefined');
                    justify = TextAlignment.Left;
                    break;
            }
            break;
        case 2:
            switch (halign) {
                case 0:
                    justify = TextAlignment.MiddleLeft;
                    break;
                case 1:
                    justify = TextAlignment.MiddleCenter;
                    break;
                case 2:
                    justify = TextAlignment.MiddleRight;
                    break;
                default:
                    reader.output.warn('text align undefined');
                    justify = TextAlignment.Left;
                    break;
            }
            break;
        case 3:
            switch (halign) {
                case 0:
                    justify = TextAlignment.TopLeft;
                    break;
                case 1:
                    justify = TextAlignment.TopCenter;
                    break;
                case 2:
                    justify = TextAlignment.TopRight;
                    break;
                default:
                    reader.output.warn('text align undefined');
                    justify = TextAlignment.Left;
                    break;
            }
            break;
        default:
            reader.output.warn('text align undefined');
            justify = TextAlignment.Left;
            break;
    }
    text.justify = justify;
}

function readDxfSolid(loader: DxfLoader, reader: DxfReader, solid: Partial<DwgSolidData>) {
    readDxfEntity(loader, reader, solid);
    reader.atSubclassData('AcDbTrace');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcXCoord:
                solid.a = item.value;
                break;
            case xCode.xcXCoord + 1:
                solid.b = item.value;
                break;
            case xCode.xcXCoord + 2:
                solid.c = item.value;
                break;
            case xCode.xcXCoord + 3:
                solid.d = item.value;
                break;
            case xCode.xcThickness:
                // solid.thickness = item.value;
                break;
            case xCode.xcNormalX:
                // solid.normal = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readDxfInsert(loader: DxfLoader, reader: DxfReader, insert: Partial<DwgInsertData & { hasAttributes: boolean }>) {
    readDxfEntity(loader, reader, insert);
    reader.atSubclassData('AcDbBlockReference');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcHasSubentities:
                if (item.value == 1) {
                    insert.hasAttributes = true;
                }
                break;
            case xCode.xcBlockName:
                insert.block = loader.blocks[item.value];
                break;
            case xCode.xcXCoord:
                insert.position = item.value;
                break;
            case xCode.xcReal + 1:
                if (insert.scale === undefined) {
                    insert.scale = [item.value, item.value, item.value];
                } else {
                    insert.scale[0] = item.value;
                }
                break;
            case xCode.xcReal + 2:
                if (insert.scale === undefined) {
                    insert.scale = [1.0, 1.0, 1.0];
                }
                insert.scale[1] = item.value;
                break;
            case xCode.xcReal + 3:
                if (insert.scale === undefined) {
                    insert.scale = [1.0, 1.0, 1.0];
                }
                insert.scale[2] = item.value;
                break;
            case xCode.xcAngle:
                insert.rotation = item.value * Math.PI / 180.0;
                break;
            case xCode.xcNormalX:
                // insert.normal = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readDxfPolyline3d(loader: DxfLoader, reader: DxfReader, polyline: Partial<DxfPolylineData>) {
    readDxfEntity(loader, reader, polyline);
    polyline.type = reader.atSubclassData('AcDb3dPolyline', 'AcDb2dPolyline', 'AcDbPolyFaceMesh', 'AcDbPolygonMesh');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcHasSubentities:
                polyline.hasSubset = true;
                break;
            case xCode.xcXCoord:
                polyline.position = item.value;
                break;
            case xCode.xcThickness:
                polyline.thickness = item.value;
                break;
            case xCode.xcInt16:
                polyline.flags = item.value;
                break;
            case xCode.xcReal:
                polyline.startWidth = item.value;
                break;
            case xCode.xcReal + 1:
                polyline.endWidth = item.value;
                break;
            case xCode.xcInt16 + 5:
                polyline.typeFlags = item.value;
                break;
            case xCode.xcNormalX:
                polyline.normal = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readDxfVertex(loader: DxfLoader, reader: DxfReader, vertex: Partial<DxfVertexData>) {
    readDxfEntity(loader, reader, vertex);
    if (reader.version > Version.AC1009) {
        reader.atSubclassData('AcDbVertex');
        for (; ;) {
            const item = reader.read();
            if (!item) {
                break;
            }
            switch (item.code) {
                default:
                    reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                    break;
            }
        }
    }
    vertex.type = reader.atSubclassData('AcDbVertex', 'AcDb2dVertex', 'AcDb3dPolylineVertex', 'AcDbPolygonMeshVertex', 'AcDbPolyFaceMeshVertex');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcXCoord:
                vertex.position = item.value;
                break;
            case xCode.xcReal:
                vertex.startWidth = item.value;
                break;
            case xCode.xcReal + 1:
                vertex.endWidth = item.value;
                break;
            case xCode.xcReal + 2:
                vertex.bulge = item.value;
                break;
            case xCode.xcInt16:
                vertex.flags = item.value;
                break;
            case xCode.xcAngle:
                vertex.angle = item.value;
                break;
            case xCode.xcVertexIdentifier:
                vertex.identifier = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readSubset(loader: DxfLoader, reader: DxfReader, subset: DxfEntity[]) {
    for (; ;) {
        const cls = reader.readVerify(xCode.xcStart);
        if ('SEQEND' === cls) {
            skepEntity(reader);
            break;
        }
        reader.pushBackItem();
        const e = readEntity(loader, reader);
        if (e) {
            subset.push(e);
        }
    }
}

function readEntity(loader: DxfLoader, reader: DxfReader): DxfEntity | undefined {
    const cls = reader.readVerify(xCode.xcStart);
    switch (cls) {
        case 'LINE': {
            const line: Partial<DwgLineData> = {};
            return {
                $cls: DwgType.line,
                entity: line,
                dxf: readAcDbObject(loader, reader, line, readDxfLine),
            }
        }
        case 'CIRCLE': {
            const circle: Partial<DwgCircleData> = {};
            return {
                $cls: DwgType.circle,
                entity: circle,
                dxf: readAcDbObject(loader, reader, circle, readDxfCircle),
            }
        }
        case 'ARC': {
            const arc: Partial<DwgArcData> = {};
            return {
                $cls: DwgType.arc,
                entity: arc,
                dxf: readAcDbObject(loader, reader, arc, readDxfArc),
            }
        }
        case 'LWPOLYLINE': {
            const polyline: Partial<DwgPolylineData> = {};
            return {
                $cls: DwgType.polyline,
                entity: polyline,
                dxf: readAcDbObject(loader, reader, polyline, readDxfLwPolyline),
            }
        }
        case 'TEXT': {
            const text: Partial<DwgTextData> = {};
            return {
                $cls: DwgType.text,
                entity: text,
                dxf: readAcDbObject(loader, reader, text, readDxfText),
            }
        }
        case 'SOLID': {
            const solid: Partial<DwgSolidData> = {};
            return {
                $cls: DwgType.solid,
                entity: solid,
                dxf: readAcDbObject(loader, reader, solid, readDxfSolid),
            }
        }
        case 'INSERT': {
            const insert: Partial<DwgInsertData & { hasAttributes: boolean }> = {};
            const e: DxfEntity = {
                $cls: DwgType.insert,
                entity: insert,
                dxf: readAcDbObject(loader, reader, insert, readDxfInsert),
            }
            if (insert.hasAttributes) {
                delete insert.hasAttributes;
                e.subset = [];
                readSubset(loader, reader, e.subset);
            }
            return e;
        }
        case 'POLYLINE': {
            const polyline: Partial<DxfPolylineData> = {};
            const dxf = readAcDbObject(loader, reader, polyline, readDxfPolyline3d);
            if (polyline.hasSubset) {
                const subset: DxfEntity[] = [];
                readSubset(loader, reader, subset);
                if ((polyline.type === 'AcDb2dPolyline') || (polyline.type === '')) {
                    const vertices: vec3[] = [];
                    for (let i = 0; i < subset.length; i++) {
                        const e = subset[i].entity as DxfVertexData;
                        if (e.position) {
                            vertices.push([e.position[0], e.position[1], e.bulge ?? 0.0]);
                        }
                    }
                    const p: Partial<DwgPolylineData> = {
                        color: polyline.color,
                        layer: polyline.layer,
                        linetype: polyline.linetype,
                        lineweight: polyline.lineweight,
                        ltscale: polyline.ltscale,
                        vertices,
                        flags: polyline.flags,
                        width: polyline.startWidth,
                        elevation: polyline.position ? polyline.position[2] : undefined,
                    }
                    return {
                        $cls: DwgType.polyline,
                        entity: p,
                        dxf,
                    }
                } else if (polyline.type === 'AcDb3dPolyline') {
                    const vertices: vec3[] = [];
                    for (let i = 0; i < subset.length; i++) {
                        const e = subset[i].entity as DxfVertexData;
                        if (e.position) {
                            vertices.push(e.position);
                        }
                    }
                    const p: Partial<DwgPolyline3dData> = {
                        color: polyline.color,
                        layer: polyline.layer,
                        linetype: polyline.linetype,
                        lineweight: polyline.lineweight,
                        ltscale: polyline.ltscale,
                        vertices,
                        flags: polyline.flags,
                    }
                    return {
                        $cls: DwgType.polyline3d,
                        entity: p,
                        dxf,
                    }
                }
            }
            return undefined;
        }
        case 'VERTEX': {
            const vertex: Partial<DxfVertexData> = {};
            return {
                $cls: '',
                entity: vertex,
                dxf: readAcDbObject(loader, reader, vertex, readDxfVertex),
            }
        }
        default: {
            skepEntity(reader);
            break;
        }
    }
}

async function readDxfEntities(loader: DxfLoader, reader: DxfReader) {
    const entities: Record<string, DxfEntity[]> = {};
    const layouts = reader.drawing.layouts;
    const model = layouts.model;
    let paper = layouts.itemByName('*PAPER_SPACE');
    for (; ;) {
        const value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ('ENDSEC' === value.value)) {
            for (const id in entities) {
                const layout = layouts.itemById(id);
                if (layout !== undefined) {
                    const editor = layout.editor();
                    await editor.beginEdit();
                    try {
                        const e = entities[id];
                        for (let i = 0; i < e.length; i++) {
                            await editor.addEntity(e[i].$cls, e[i].entity);
                        }
                    } finally {
                        await editor.endEdit();
                    }
                } else {
                    reader.output.warn('Unexpected entity block {0}', id);
                }
            }
            break;
        }
        reader.pushBackItem();
        const entity = readEntity(loader, reader);
        if (entity !== undefined) {
            let layout: DwgLayout | undefined;
            if (entity.dxf.owner === '') {
                if (entity.entity.$paper) {
                    if (paper === undefined) {
                        paper = await layouts.add({
                            name: '*PAPER_SPACE',
                        });
                    }
                    layout = paper;
                } else {
                    layout = model;
                }
            } else {
                layout = loader.layouts[entity.dxf.owner];
            }
            delete entity.entity.$paper;
            if (layout) {
                let e = entities[layout.$id!];
                if (e === undefined) {
                    e = [];
                    entities[layout.$id!] = e;
                }
                e.push(entity);
            }
        }
    }
}

function readBlock(loader: DxfLoader, reader: DxfReader, block: Partial<DwgBlockData>) {
    readDxfEntity(loader, reader, undefined);
    reader.atSubclassData('AcDbBlockBegin');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            case xCode.xcBlockName:
                block.name = item.value;
            case 3:
                break;
            case xCode.xcInt16:
                // block.anonymous = (item.value & 0x1) === 0x1;
                // block.isXref = (item.value & 0x4) === 0x4;
                // block.isOverlay = (item.value & 0x8) === 0x8;
                break;
            case xCode.xcInt16 + 1:
                // block.unloaded = item.value !== 0;
                break;
            case xCode.xcXCoord:
                // block.origin = item.value;
                break;
            case xCode.xcXRefPath:
                // block.xpath = item.value;
                break;
            case xCode.xcSymTableRecComments:
                // block.comment = item.value;
                break;
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

function readEndBlock(loader: DxfLoader, reader: DxfReader, block: Partial<DwgBlockData>) {
    readDxfEntity(loader, reader, undefined);
    reader.atSubclassData('AcDbBlockEnd');
    for (; ;) {
        const item = reader.read();
        if (!item) {
            break;
        }
        switch (item.code) {
            default:
                reader.output.warn('Unexpected code {0} at line {1}', item.code, reader.line - 1);
                break;
        }
    }
}

async function readDxfBlocks(loader: DxfLoader, reader: DxfReader) {
    for (; ;) {
        let value = reader.read();
        if (!value) {
            break;
        }
        if ((value.code === xCode.xcStart) && ("ENDSEC" === value.value)) {
            break;
        }
        if (value.value !== 'BLOCK') {
            throw new Error(`Expected value "BLOCK", got "${value.value}" at line ${reader.line}`);
        }
        const block: Partial<DwgBlockData> = {};
        readAcDbObject(loader, reader, block, readBlock);
        if (block.name) {
            let blk = loader.blocks[block.name];
            if (blk === undefined) {
                blk = await reader.drawing.blocks.add(block);
                loader.blocks[block.name] = blk;
            }
            blk.beginUpdate();
            try {
                for (; ;) {
                    value = reader.read();
                    if (!value) {
                        break;
                    }
                    if ((value.code === xCode.xcStart) && ("ENDBLK" === value.value)) {
                        readAcDbObject(loader, reader, block, readEndBlock);
                        break;
                    }
                    reader.pushBackItem();
                    const e = readEntity(loader, reader);
                    if (e) {
                        blk.addEntity(e.$cls, e.entity);
                    }
                }
            } finally {
                blk.endUpdate();
            }
        }
    }
}

async function readDxfObjects(_loader: DxfLoader, reader: DxfReader) {
    skepSection(reader);
}

async function readDxfDataStorage(_loader: DxfLoader, reader: DxfReader) {
    skepSection(reader);
}

declare interface DxfClass {
    readonly dxf: string;
    readonly cpp: string;
    readonly app: string;
    readonly flags: number;
    readonly instances: number;
    readonly zombie: boolean;
    readonly entity: boolean;
}

export default class DxfLoader {
    public variables: Record<string, any> = {};
    public classes: Record<string, DxfClass> = {};
    public styles: Record<string, DwgTextStyle> = {};
    public linetypes: Record<string, DwgLinetype> = {};
    public layers: Record<string, DwgLayer> = {};
    public blocks: Record<string, DwgBlock> = {};
    public layouts: Record<string, DwgLayout | undefined> = {};

    async readDxfFile(reader: DxfReader) {
        let flags = 0;
        while (true) {
            let value = reader.readVerify(xCode.xcStart);
            if (value === 'EOF') {
                break;
            }
            if (value !== "SECTION") {
                throw new Error(`Expected value "SECTION", got "${value}" at line ${reader.line}")`);
            }
            value = reader.readVerify(xCode.xcSymbolTableName);
            switch (value) {
                case 'HEADER':
                    if ((flags & 0x1) == 0x1) {
                        throw new Error("HEADER section duplicated");
                    }
                    readDxfHeader(this, reader);
                    flags |= 0x1;
                    break;
                case 'CLASSES':
                    if ((flags & 0x1) == 0) {
                        throw new Error(`HEADER section is not exists before ${reader.line}`);
                    }
                    if ((flags & 0x2) == 0x2) {
                        throw new Error("CLASSES section duplicated");
                    }
                    readDxfClasses(this, reader);
                    flags |= 0x2;
                    break;
                case 'BLOCKS':
                    if ((flags & 0x8) == 0x8) {
                        throw new Error("BLOCKS section duplicated");
                    }
                    if ((flags & 0x4) == 0) {
                        throw new Error(`TABLES section is not exists before ${reader.line}`);
                    }
                    await readDxfBlocks(this, reader);
                    flags |= 0x8;
                    break;
                case 'TABLES':
                    if ((flags & 0x4) == 0x4) {
                        throw new Error("TABLES section duplicated");
                    }
                    await readDxfTables(this, reader);
                    flags |= 0x4;
                    break;
                case 'ENTITIES':
                    if ((flags & 0x10) == 0x10) {
                        throw new Error("ENTITIES section duplicated");
                    }
                    if ((flags & 0x8) == 0) {
                        throw new Error(`BLOCKS section is not exists before ${reader.line}`);
                    }
                    await readDxfEntities(this, reader);
                    flags |= 0x10;
                    break;
                case 'OBJECTS':
                    if ((flags & 0x20) == 0x20) {
                        throw new Error("OBJECTS section duplicated");
                    }
                    if ((flags & 0x10) == 0) {
                        throw new Error(`ENTITIES section is not exists before ${reader.line}`);
                    }
                    await readDxfObjects(this, reader);
                    flags |= 0x20;
                    break;
                case 'THUMBNAILIMAGE':
                    if ((flags & 0x40) == 0x40) {
                        throw new Error("THUMBNAILIMAGE section duplicated");
                    }
                    skepSection(reader);
                    flags |= 0x40;
                    break;
                case 'ACDSDATA':
                    if ((flags & 0x80) == 0x80) {
                        throw new Error("ACDSDATA section duplicated");
                    }
                    await readDxfDataStorage(this, reader);
                    flags |= 0x80;
                    break;
                default:
                    reader.output.warn(`Bad section ${value}`);
                    skepSection(reader);
                    break;
            }
        }
    }
}