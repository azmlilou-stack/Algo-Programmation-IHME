#!/usr/bin/env python3
"""Client GitHub Actions pour demander un déploiement IHME sans exposer les jetons."""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def request_deployment(url, token, digest, registry_token=""):
    address = urllib.parse.urlsplit(url)
    if (
        address.scheme != "https"
        or not address.hostname
        or address.username
        or address.password
        or address.query
        or address.fragment
        or not re.fullmatch(r"/__deploy/(suivi|p[0-9]{2})", address.path)
    ):
        raise ValueError("URL HTTPS de déploiement invalide.")
    if not token or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("Jeton privé et digest SHA-256 requis.")

    body = {"digest": digest}
    if registry_token:
        body["registry_token"] = registry_token
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
        },
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    with urllib.request.build_opener(NoRedirect()).open(request, timeout=440) as response:
        data = json.load(response)
        if response.status != 200 or data.get("status") != "healthy":
            raise ValueError("Version non saine.")
        return data


if __name__ == "__main__":
    try:
        result = request_deployment(
            os.environ.get("DEPLOY_URL", ""),
            os.environ.get("DEPLOY_TOKEN", ""),
            os.environ.get("DIGEST", ""),
            os.environ.get("REGISTRY_TOKEN", ""),
        )
        print("Déploiement vérifié : " + result["project"] + " @ " + result["digest"])
    except ValueError as error:
        print(
            "Paramètres ou réponse de déploiement invalides : " + str(error),
            file=sys.stderr,
        )
        sys.exit(1)
    except urllib.error.HTTPError as error:
        print(
            "Le serveur de déploiement a répondu avec le code HTTP "
            + str(error.code)
            + ". Vérifier l’URL et le jeton dans les paramètres GitHub Actions.",
            file=sys.stderr,
        )
        sys.exit(1)
    except urllib.error.URLError as error:
        reason = error.reason
        reason_type = type(reason).__name__
        print(
            "Impossible de joindre le serveur de déploiement ("
            + reason_type
            + "). Vérifier l’URL et la disponibilité du service.",
            file=sys.stderr,
        )
        sys.exit(1)
    except OSError:
        print(
            "Erreur réseau ou délai dépassé pendant le déploiement. "
            "Vérifier la disponibilité du service.",
            file=sys.stderr,
        )
        sys.exit(1)
