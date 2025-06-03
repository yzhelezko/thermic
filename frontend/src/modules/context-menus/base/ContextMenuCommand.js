// Command pattern for context menu actions
export class ContextMenuCommand {
    constructor(id, name, icon, action, condition = null) {
        this.id = id;
        this.name = name;
        this.icon = icon;
        this.action = action;
        this.condition = condition;
    }

    isEnabled(context) {
        return this.condition ? this.condition(context) : true;
    }

    async execute(context) {
        try {
            return await this.action(context);
        } catch (error) {
            console.error(`Error executing command ${this.id}:`, error);
            throw error;
        }
    }
}

export class ContextMenuSeparator {
    constructor() {
        this.isSeparator = true;
    }
}

export class CommandRegistry {
    constructor() {
        this.commands = new Map();
    }

    register(command) {
        this.commands.set(command.id, command);
        return this;
    }

    registerSeparator() {
        const separator = new ContextMenuSeparator();
        this.commands.set(`separator-${Date.now()}`, separator);
        return this;
    }

    getCommand(commandId) {
        return this.commands.get(commandId);
    }

    getCommands(context = null) {
        const commands = Array.from(this.commands.values());
        if (context) {
            return commands.filter(cmd => 
                cmd.isSeparator || cmd.isEnabled(context)
            );
        }
        return commands;
    }

    executeCommand(commandId, context) {
        const command = this.commands.get(commandId);
        if (command && !command.isSeparator && command.isEnabled(context)) {
            return command.execute(context);
        }
        throw new Error(`Command not found or not enabled: ${commandId}`);
    }
} 