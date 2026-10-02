const remoteFailurePrefix = /^Error invoking remote method '[^']+': (?:[\w$.@/-]+: )?/;

export const remoteFailureMessage = (message: string) => message.replace(remoteFailurePrefix, "");
