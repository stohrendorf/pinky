export interface NamedTreeItem {
    id: string;
    name: string;
    color?: string;
    mute?: boolean;
    solo?: boolean;
}

interface NameTreeFolder<T extends NamedTreeItem> {
    label: string;
    path: string;
    folders: NameTreeFolder<T>[];
    items: T[];
}

export interface NameTreeFolderEntry {
    kind: 'folder';
    label: string;
    path: string;
    depth: number;
    ancestors: string[];
    itemCount: number;
}

export interface NameTreeItemEntry<T extends NamedTreeItem> {
    kind: 'item';
    item: T;
    label: string;
    depth: number;
    ancestors: string[];
}

export type NameTreeEntry<T extends NamedTreeItem> = NameTreeFolderEntry | NameTreeItemEntry<T>;

function pathParts(name: string): string[] {
    return name.split('/').map(part => part.trim()).filter(Boolean);
}

function createFolder<T extends NamedTreeItem>(label: string, path: string): NameTreeFolder<T> {
    return {label, path, folders: [], items: []};
}

export function flattenNameTree<T extends NamedTreeItem>(items: T[]): NameTreeEntry<T>[] {
    const root = createFolder<T>('', '');

    for (const item of items) {
        const parts = pathParts(item.name);
        parts.pop();
        let folder = root;

        for (const part of parts) {
            const path = folder.path ? `${folder.path}/${part}` : part;
            let child = folder.folders.find(candidate => candidate.label === part);
            if (!child) {
                child = createFolder<T>(part, path);
                folder.folders.push(child);
            }
            folder = child;
        }

        folder.items.push(item);
    }

    const entries: NameTreeEntry<T>[] = [];
    const countItems = (folder: NameTreeFolder<T>): number => folder.items.length + folder.folders.reduce((total, child) => total + countItems(child), 0);
    const visit = (folder: NameTreeFolder<T>, depth: number, ancestors: string[]) => {
        for (const child of folder.folders) {
            entries.push({
                kind: 'folder',
                label: child.label,
                path: child.path,
                depth,
                ancestors,
                itemCount: countItems(child)
            });
            visit(child, depth + 1, [...ancestors, child.path]);
        }
        for (const item of folder.items) {
            const parts = pathParts(item.name);
            entries.push({
                kind: 'item',
                item,
                label: parts.pop() || 'Untitled',
                depth,
                ancestors
            });
        }
    };

    visit(root, 0, []);
    return entries;
}