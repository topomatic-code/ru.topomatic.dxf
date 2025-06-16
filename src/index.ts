import DxfLoader from "./loader";
import { DxfBaseReader } from "./reader";

class DfxImporter implements WorkspaceImporter {
    constructor(private readonly output: OutputChannel) {

    }

    async import(workspace: Workspace, model: unknown): Promise<void> {
        const buffer = await workspace.root.get();
        const reader = new DxfBaseReader(buffer, model as Drawing, this.output);
        const loader = new DxfLoader();
        try {
            await loader.readDxfFile(reader);
        } catch (e) {
            this.output.error(e as Error);
            throw e;
        }
    }
}

export default {
    dxf: (e: Context) => {
        return new DfxImporter(e.createOutputChannel('dxf'));
    }
}