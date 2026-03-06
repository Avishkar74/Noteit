Docker build and deploy instructions
=================================

This folder contains Docker assets for the `backend` service.

Build locally
-------------

From the repository root, run:

```bash
docker build -f docker/Dockerfile -t snabbly-backend:latest .
```

Run locally
-----------

```bash
docker run --rm -p 3000:3000 --name snabbly-backend snabbly-backend:latest
```

Push to registry (Azure Container Registry example)
-------------------------------------------------

```bash
# Build
docker build -f docker/Dockerfile -t myregistry.azurecr.io/snabbly-backend:latest .
# Login
az acr login --name myregistry
# Push
docker push myregistry.azurecr.io/snabbly-backend:latest
```

Deploy to Azure Container Apps (high level)
------------------------------------------

1. Create an Azure Container Registry and push your image.
2. Create an Azure Container App environment and deploy the image.
3. Configure environment variables and scale settings in Azure.

See Azure docs or ask me for a step-by-step guide.
