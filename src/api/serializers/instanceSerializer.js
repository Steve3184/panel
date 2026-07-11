export function serializeInstance(instance, user, status) {
    const userPermission = user?.role === 'admin' ? 'full-control' : instance.permissions?.[user?.id]?.terminal;
    const canViewSensitiveConfig = user?.role === 'admin' || userPermission === 'full-control';
    const serialized = {
        id: instance.id,
        name: instance.name,
        type: instance.type,
        command: instance.command,
        autoStartOnBoot: instance.autoStartOnBoot,
        autoDeleteOnExit: instance.autoDeleteOnExit,
        autoRestart: instance.autoRestart,
        permissions: user?.role === 'admin'
            ? instance.permissions
            : { [user.id]: instance.permissions?.[user.id] },
        dockerConfig: instance.dockerConfig ? { image: instance.dockerConfig.image } : {},
        ...(status ? { status } : {})
    };

    if (canViewSensitiveConfig) {
        return { ...instance, ...(status ? { status } : {}) };
    }

    return serialized;
}
