<?php

use OpenEMR\Menu\PatientMenuEvent;

function agentforge_patient_menu_item(PatientMenuEvent $event): PatientMenuEvent
{
    $item = new stdClass();
    $item->label = xlt('Prepare for visit');
    // ModulesApplication injects the dispatcher into this bootstrap scope.
    // Keep the launcher URL relative so this remains compatible with the
    // deployed OpenEMR release's globals/kernel boundary.
    $item->url = '/interface/modules/custom_modules/oe-module-agentforge/public/index.php';
    $item->menu_id = 'agentforge_prepare';
    $item->target = 'mod';
    $event->setMenu([...$event->getMenu(), $item]);
    return $event;
}

$eventDispatcher->addListener(PatientMenuEvent::MENU_UPDATE, 'agentforge_patient_menu_item');

// ModulesApplication also provides $classLoader (a ModulesClassLoader). The
// write endpoint loads src/autoload.php itself, so it does not depend on this.
if (isset($classLoader) && method_exists($classLoader, 'registerNamespaceIfNotExists')) {
    $classLoader->registerNamespaceIfNotExists('OpenEMR\\Modules\\AgentForge\\', __DIR__ . '/src');
}
