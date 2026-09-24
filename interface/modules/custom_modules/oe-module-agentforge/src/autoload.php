<?php

/**
 * PSR-4 autoloader for the AgentForge module namespace.
 *
 * The deployed OpenEMR 8.0.0 registers this namespace through the module
 * bootstrap, but the write endpoint and the dependency-free test script must
 * not depend on the module being active, so both load this file directly.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    David Slayback <68602513+DavidSlayback@users.noreply.github.com>
 * @copyright Copyright (c) 2026 David Slayback
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'OpenEMR\\Modules\\AgentForge\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/' . $relative . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
