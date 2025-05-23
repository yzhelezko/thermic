export namespace main {
	
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

