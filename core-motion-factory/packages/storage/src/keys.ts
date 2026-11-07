/** Canonical object keys. Everything lives under the organization prefix (tenant isolation). */

const ext = (name: string) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1]!.toLowerCase() : "bin";
};

export const objectKeys = {
  assetOriginal: (orgId: string, projectId: string, assetId: string, fileName: string) =>
    `org/${orgId}/projects/${projectId}/assets/${assetId}/original.${ext(fileName)}`,
  assetProxy: (orgId: string, projectId: string, assetId: string) => `org/${orgId}/projects/${projectId}/assets/${assetId}/proxy.mp4`,
  assetAudio: (orgId: string, projectId: string, assetId: string) => `org/${orgId}/projects/${projectId}/assets/${assetId}/audio-16k.wav`,
  assetWaveform: (orgId: string, projectId: string, assetId: string) => `org/${orgId}/projects/${projectId}/assets/${assetId}/waveform.json`,
  assetThumb: (orgId: string, projectId: string, assetId: string, index: number) =>
    `org/${orgId}/projects/${projectId}/assets/${assetId}/thumb-${String(index).padStart(3, "0")}.jpg`,
  brandAsset: (orgId: string, brandId: string, brandAssetId: string, fileName: string) =>
    `org/${orgId}/brands/${brandId}/${brandAssetId}.${ext(fileName)}`,
  generatedAudio: (orgId: string, projectId: string, name: string) => `org/${orgId}/projects/${projectId}/generated/${name}`,
  artifactFile: (orgId: string, projectId: string, name: string) => `org/${orgId}/projects/${projectId}/artifacts/${name}`,
  render: (orgId: string, projectId: string, renderId: string, kind: string) => `org/${orgId}/projects/${projectId}/renders/${renderId}/${kind}.mp4`,
  renderThumb: (orgId: string, projectId: string, renderId: string) => `org/${orgId}/projects/${projectId}/renders/${renderId}/thumbnail.jpg`,
  delivery: (orgId: string, projectId: string, renderId: string, name: string) => `org/${orgId}/projects/${projectId}/delivery/${renderId}/${name}`,
};

/** Extracts the organization id from a key — used to enforce tenant isolation on file access. */
export function organizationOfKey(key: string): string | null {
  const m = /^org\/([^/]+)\//.exec(key);
  return m ? m[1]! : null;
}
