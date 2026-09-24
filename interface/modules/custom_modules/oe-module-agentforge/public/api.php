<?php

/**
 * AgentForge service-to-OpenEMR write endpoint (front controller).
 *
 * Internal network only: Caddy answers 404 for this path publicly. There is no
 * OpenEMR session here; the HMAC request signature, nonce replay table and the
 * module-signed context token (see src/Api/AgentForgeApi.php) are the
 * authentication boundary, so $ignoreAuth is set before globals.php.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

$ignoreAuth = true;
require_once dirname(__DIR__, 4) . '/globals.php';
require_once dirname(__DIR__) . '/src/autoload.php';

use OpenEMR\Common\Logging\SystemLogger;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Modules\AgentForge\Api\AgentForgeApi;
use OpenEMR\Modules\AgentForge\Http\ApiError;
use OpenEMR\Modules\AgentForge\Http\JsonResponder;
use Symfony\Component\HttpFoundation\Request;

$responder = new JsonResponder();
// OpenEMR 8.0.0 has no ServiceContainer::getLogger(); this entry point is the
// only place the logger is constructed.
$logger = new SystemLogger();
$request = OEGlobalsBag::getInstance()->get('restRequest');
if (!$request instanceof Request) {
    $responder->send(500, ['error' => 'write_failed']);
    return;
}
$rawCorrelationId = $request->headers->get('x-correlation-id') ?? '';
$correlationId = preg_match('/^[A-Za-z0-9._:-]{1,80}$/', $rawCorrelationId) === 1 ? $rawCorrelationId : '';
$headers = [];
foreach (['x-agentforge-key-id', 'x-agentforge-timestamp', 'x-agentforge-nonce', 'x-agentforge-content-sha256', 'x-agentforge-signature', 'x-agentforge-context-token'] as $name) {
    $value = $request->headers->get($name);
    if (is_string($value)) {
        $headers[$name] = $value;
    }
}

try {
    [$status, $body] = AgentForgeApi::fromEnvironment()->handle($request->getMethod(), $request->query->all(), $headers, $request->getContent(), time());
    $responder->send($status, $body, $correlationId);
} catch (ApiError $error) {
    if ($error->httpStatus >= 500) {
        $logger->error('AgentForge module request failed', ['error_code' => $error->errorCode, 'correlation_id' => $correlationId, 'exception' => $error]);
    }
    $responder->send($error->httpStatus, $error->toBody(), $correlationId);
} catch (\Throwable $error) {
    $logger->error('AgentForge module request failed', ['error_code' => 'write_failed', 'correlation_id' => $correlationId, 'exception' => $error]);
    $responder->send(500, ['error' => 'write_failed'], $correlationId);
}
