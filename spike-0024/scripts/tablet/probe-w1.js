(async () => {
  const out = { userAgent: navigator.userAgent, origin: location.origin, isSecureContext, gpuInNavigator: 'gpu' in navigator };
  if (!out.gpuInNavigator) return JSON.stringify(out);
  const adapter = await navigator.gpu.requestAdapter();
  out.adapterIsNull = adapter === null;
  if (adapter === null) return JSON.stringify(out);
  const i = adapter.info;
  out.info = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description };
  out.isFallbackAdapter = adapter.isFallbackAdapter ?? i.isFallbackAdapter;
  out.features = [...adapter.features].sort();
  const l = adapter.limits;
  out.limits = {};
  for (const k of ['maxTextureDimension2D', 'maxTextureArrayLayers', 'maxBindGroups', 'maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage', 'maxStorageBuffersPerShaderStage', 'maxUniformBufferBindingSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxBufferSize', 'maxVertexAttributes', 'maxColorAttachments']) out.limits[k] = l[k];
  out.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat();
  try {
    const device = await adapter.requestDevice();
    out.requestDevice = 'resolved';
    out.deviceFeatures = [...device.features].sort();
    device.destroy();
  } catch (error) {
    out.requestDevice = 'rejected: ' + (error && error.message);
  }
  return JSON.stringify(out);
})()
