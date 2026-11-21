# Kubernetes Deployment Guide

This guide covers deploying the Stellar Footprint Service to Kubernetes using either the **Helm chart** (recommended for production) or the **flat manifests** in `k8s/`.

---

## Prerequisites

- A running Kubernetes cluster (local: [minikube](https://minikube.sigs.k8s.io/) or [kind](https://kind.sigs.k8s.io/); cloud: EKS, GKE, AKS)
- `kubectl` configured to target your cluster (`kubectl cluster-info`)
- [Helm 3.8+](https://helm.sh/docs/intro/install/) (for the Helm chart)
- The service Docker image built and pushed to a registry accessible by your cluster

Build and push the image:

```bash
docker build -t your-registry/stellar-footprint-service:latest .
docker push your-registry/stellar-footprint-service:latest
```

---

## Deploying with the Helm Chart (Recommended)

The production Helm chart lives in `charts/stellar-footprint-service/`. It includes parameterized templates for Deployment, Service, Ingress (with cert-manager TLS), ConfigMap, Secret, HPA (70% CPU target), Pod Disruption Budget (minAvailable: 1), NetworkPolicy, and ServiceAccount.

### 1. Configure values

Copy and edit a custom values file:

```bash
cp charts/stellar-footprint-service/values.yaml my-values.yaml
```

Edit `my-values.yaml`:

```yaml
image:
  repository: your-registry/stellar-footprint-service
  tag: "1.0.0"

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: footprint.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: stellar-footprint-tls
      hosts:
        - footprint.example.com

redis:
  enabled: true
  host: redis-master
  port: 6379

secrets:
  TESTNET_RPC_URL: "https://soroban-testnet.stellar.org"
  MAINNET_RPC_URL: "https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>"
  TESTNET_SECRET_KEY: "<your_testnet_secret_key>"
  MAINNET_SECRET_KEY: "<your_mainnet_secret_key>"
```

> **Security:** Store secrets in a sealed or external secrets manager for production. The `secrets` block in values.yaml is convenient for development but should not be committed with real credentials.

### 2. Install the chart

```bash
helm install stellar-footprint charts/stellar-footprint-service \
  -f my-values.yaml \
  -n stellar-footprint \
  --create-namespace
```

### 3. Verify the deployment

```bash
kubectl rollout status deployment/stellar-footprint -n stellar-footprint
kubectl get pods -n stellar-footprint
kubectl get hpa -n stellar-footprint
kubectl get pdb -n stellar-footprint
kubectl get ingress -n stellar-footprint
```

### 4. Test the service

```bash
kubectl port-forward svc/stellar-footprint 8080:80 -n stellar-footprint
curl http://localhost:8080/api/v1/health/ready
```

### 5. Upgrade

```bash
helm upgrade stellar-footprint charts/stellar-footprint-service \
  -f my-values.yaml \
  -n stellar-footprint
```

### Key configuration options

| Parameter | Default | Description |
|---|---|---|
| `replicaCount` | `2` | Pod replicas (ignored when HPA enabled) |
| `image.repository` | `stellar-footprint-service` | Container image |
| `image.tag` | `""` (uses `appVersion`) | Image tag |
| `service.port` | `80` | Service port |
| `service.targetPort` | `3000` | Container port |
| `ingress.enabled` | `false` | Enable Ingress with TLS |
| `ingress.annotations` | `cert-manager.io/cluster-issuer: letsencrypt-prod` | cert-manager annotations |
| `autoscaling.enabled` | `true` | Enable HPA |
| `autoscaling.minReplicas` | `2` | Minimum pods |
| `autoscaling.maxReplicas` | `10` | Maximum pods |
| `autoscaling.targetCPUUtilizationPercentage` | `70` | CPU target for scaling |
| `podDisruptionBudget.enabled` | `true` | Enable PDB |
| `podDisruptionBudget.minAvailable` | `1` | Min available during disruptions |
| `networkPolicy.enabled` | `true` | Restrict ingress/egress |
| `redis.enabled` | `false` | Set REDIS_URL and allow egress to Redis |
| `config.*` | See `values.yaml` | Non-sensitive env vars (ConfigMap) |
| `secrets.*` | See `values.yaml` | Sensitive env vars (Secret) |

### Environment variables

The ConfigMap uses the zod-validated env-var names from `src/config/env.ts`. Setting a present-but-invalid value (e.g. `LOG_LEVEL=verbose`) will crash-loop the pod in production because `validateEnv()` calls `process.exit(1)`.

Non-sensitive vars (ConfigMap): `NODE_ENV`, `PORT`, `LOG_LEVEL`, `NETWORK`, `SIMULATE_TIMEOUT_MS`, `COMPRESSION_THRESHOLD`, `RPC_POOL_TTL_MS`, `CACHE_TTL_SECONDS`, `CACHE_MAX_SIZE`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `DECODE_RATE_LIMIT_MAX`, `DECODE_RATE_LIMIT_WINDOW_MS`, `FEE_RATE_LIMIT_MAX`, `FEE_RATE_LIMIT_WINDOW_MS`, `BATCH_CONCURRENCY`, `NETWORK_STATUS_TTL_MS`, `KEEP_ALIVE_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`.

Sensitive vars (Secret): `TESTNET_RPC_URL`, `MAINNET_RPC_URL`, `FUTURENET_RPC_URL`, `TESTNET_SECRET_KEY`, `MAINNET_SECRET_KEY`, `FUTURENET_SECRET_KEY`, `API_KEYS` (optional).

### Health probes

The chart points probes directly at the canonical paths `/api/v1/health/live` and `/api/v1/health/ready` (avoiding the 308 redirect the flat manifests rely on). The readiness probe checks Redis connectivity and the RPC circuit-breaker state; if Redis is down, the pod stays not-ready until the in-memory fallback activates.

### Security hardening

The chart applies both pod-level and container-level security contexts:

- `runAsNonRoot: true`, `runAsUser/runAsGroup: 1001` (matches Dockerfile non-root user)
- `readOnlyRootFilesystem: true` with an `emptyDir` mounted at `/tmp`
- `allowPrivilegeEscalation: false`
- `capabilities.drop: [ALL]`
- `seccompProfile: RuntimeDefault`
- `automountServiceAccountToken: false`

### CI validation

The CI workflow (`.github/workflows/ci.yml`) includes a `helm` job that runs `helm lint`, renders templates with default and custom values, and validates the rendered manifests with `kubeconform`.

---

## Deploying with Flat Manifests (Legacy)

The `k8s/` directory contains flat YAML manifests for simpler deployments without Helm.

### Manifests Overview

| File | Purpose |
|---|---|
| `k8s/deployment.yaml` | Pod spec, resource limits, health probes |
| `k8s/service.yaml` | ClusterIP service exposing port 80 → 3000 |
| `k8s/hpa.yaml` | Horizontal Pod Autoscaler (2–10 replicas) |
| `k8s/configmap.yaml` | Non-sensitive environment variables |
| `k8s/secret.yaml.template` | Template for sensitive values (RPC URLs, keys) |
| `k8s/network-policy.yaml` | Ingress/egress restrictions |

### Applying the Manifests

1. Create a namespace (optional but recommended):

   ```bash
   kubectl create namespace stellar-footprint
   ```

2. Configure secrets:

   ```bash
   cp k8s/secret.yaml.template k8s/secret.yaml
   ```

   Edit `k8s/secret.yaml` with real RPC URLs and secret keys. **Never commit `k8s/secret.yaml`.**

3. Apply all manifests:

   ```bash
   kubectl apply -f k8s/ -n stellar-footprint
   ```

4. Verify:

   ```bash
   kubectl rollout status deployment/stellar-footprint-service -n stellar-footprint
   kubectl get pods -n stellar-footprint
   ```

5. Test:

   ```bash
   kubectl port-forward svc/stellar-footprint-service 8080:80 -n stellar-footprint
   curl http://localhost:8080/api/v1/health/ready
   ```

### Updating

```bash
# Pull latest image and trigger a rolling update
kubectl set image deployment/stellar-footprint-service \
  stellar-footprint-service=your-registry/stellar-footprint-service:new-tag \
  -n stellar-footprint

# Monitor the rollout
kubectl rollout status deployment/stellar-footprint-service -n stellar-footprint

# Roll back if needed
kubectl rollout undo deployment/stellar-footprint-service -n stellar-footprint
```

---

## HPA Tuning

Both the Helm chart and flat manifests scale between **2 and 10 replicas** based on CPU utilisation, targeting **70%** average utilisation.

**Tuning guidelines:**

- Lower `averageUtilization` (e.g. `50`) to scale out earlier and reduce latency spikes under bursty load.
- Increase `maxReplicas` if you expect sustained high traffic.
- Ensure the Kubernetes Metrics Server is installed for HPA to function:
  ```bash
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
  ```
- Check HPA status:
  ```bash
  kubectl get hpa -n stellar-footprint
  ```

---

## Further Reading

- [k8s/README.md](../../k8s/README.md) — manifest-level reference
- [Deployment Guide](../deployment.md) — Railway, Render, Fly.io, and VPS options
