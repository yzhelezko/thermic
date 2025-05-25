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

