export namespace main {
	
	export class SSHConfig {
	    host: string;
	    port: number;
	    username: string;
	    password?: string;
	    keyPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new SSHConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.keyPath = source["keyPath"];
	    }
	}
	export class Profile {
	    id: string;
	    name: string;
	    icon: string;
	    type: string;
	    shell: string;
	    workingDir: string;
	    environment: Record<string, string>;
	    sshConfig?: SSHConfig;
	    folderPath: string;
	    sortOrder: number;
	    // Go type: time
	    created: any;
	    // Go type: time
	    lastModified: any;
	    tags?: string[];
	    // Go type: time
	    lastUsed?: any;
	    usageCount?: number;
	    color?: string;
	    description?: string;
	    isFavorite?: boolean;
	    shortcuts?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.type = source["type"];
	        this.shell = source["shell"];
	        this.workingDir = source["workingDir"];
	        this.environment = source["environment"];
	        this.sshConfig = this.convertValues(source["sshConfig"], SSHConfig);
	        this.folderPath = source["folderPath"];
	        this.sortOrder = source["sortOrder"];
	        this.created = this.convertValues(source["created"], null);
	        this.lastModified = this.convertValues(source["lastModified"], null);
	        this.tags = source["tags"];
	        this.lastUsed = this.convertValues(source["lastUsed"], null);
	        this.usageCount = source["usageCount"];
	        this.color = source["color"];
	        this.description = source["description"];
	        this.isFavorite = source["isFavorite"];
	        this.shortcuts = source["shortcuts"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProfileFolder {
	    id: string;
	    name: string;
	    icon: string;
	    parentPath: string;
	    sortOrder: number;
	    expanded: boolean;
	    // Go type: time
	    created: any;
	    // Go type: time
	    lastModified: any;
	    color?: string;
	    sortMethod?: string;
	    isTemplate?: boolean;
	    tags?: string[];
	    description?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.parentPath = source["parentPath"];
	        this.sortOrder = source["sortOrder"];
	        this.expanded = source["expanded"];
	        this.created = this.convertValues(source["created"], null);
	        this.lastModified = this.convertValues(source["lastModified"], null);
	        this.color = source["color"];
	        this.sortMethod = source["sortMethod"];
	        this.isTemplate = source["isTemplate"];
	        this.tags = source["tags"];
	        this.description = source["description"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProfileMetrics {
	    totalProfiles: number;
	    totalFolders: number;
	    mostUsedProfiles: string[];
	    recentProfiles: string[];
	    favoriteProfiles: string[];
	    tagUsage: Record<string, number>;
	    // Go type: time
	    lastSync: any;
	
	    static createFrom(source: any = {}) {
	        return new ProfileMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalProfiles = source["totalProfiles"];
	        this.totalFolders = source["totalFolders"];
	        this.mostUsedProfiles = source["mostUsedProfiles"];
	        this.recentProfiles = source["recentProfiles"];
	        this.favoriteProfiles = source["favoriteProfiles"];
	        this.tagUsage = source["tagUsage"];
	        this.lastSync = this.convertValues(source["lastSync"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProfileTreeNode {
	    id: string;
	    name: string;
	    icon: string;
	    type: string;
	    path: string;
	    children?: ProfileTreeNode[];
	    profile?: Profile;
	    expanded: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProfileTreeNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.type = source["type"];
	        this.path = source["path"];
	        this.children = this.convertValues(source["children"], ProfileTreeNode);
	        this.profile = this.convertValues(source["profile"], Profile);
	        this.expanded = source["expanded"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SSHSession {
	
	
	    static createFrom(source: any = {}) {
	        return new SSHSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}
	export class Tab {
	    id: string;
	    title: string;
	    sessionId: string;
	    shell: string;
	    isActive: boolean;
	    connectionType: string;
	    sshConfig?: SSHConfig;
	    // Go type: time
	    created: any;
	
	    static createFrom(source: any = {}) {
	        return new Tab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.sessionId = source["sessionId"];
	        this.shell = source["shell"];
	        this.isActive = source["isActive"];
	        this.connectionType = source["connectionType"];
	        this.sshConfig = this.convertValues(source["sshConfig"], SSHConfig);
	        this.created = this.convertValues(source["created"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VirtualFilter {
	    type: string;
	    value: string;
	    limit: number;
	    sortBy: string;
	    sortOrder: string;
	    dateRange: number;
	
	    static createFrom(source: any = {}) {
	        return new VirtualFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.value = source["value"];
	        this.limit = source["limit"];
	        this.sortBy = source["sortBy"];
	        this.sortOrder = source["sortOrder"];
	        this.dateRange = source["dateRange"];
	    }
	}
	export class VirtualFolder {
	    id: string;
	    name: string;
	    icon: string;
	    type: string;
	    filter: VirtualFilter;
	    isCollapsed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VirtualFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.icon = source["icon"];
	        this.type = source["type"];
	        this.filter = this.convertValues(source["filter"], VirtualFilter);
	        this.isCollapsed = source["isCollapsed"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WSLDistribution {
	    name: string;
	    version: string;
	    state: string;
	    default: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WSLDistribution(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.state = source["state"];
	        this.default = source["default"];
	    }
	}

}

