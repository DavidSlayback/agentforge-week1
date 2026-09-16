<?php

use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Menu\PatientMenuEvent;

function agentforge_patient_menu_item(PatientMenuEvent $event): PatientMenuEvent
{
    $item = new stdClass();
    $item->label = xlt('Prepare for visit');
    $item->url = OEGlobalsBag::getInstance()->getWebRoot() . '/interface/modules/custom_modules/oe-module-agentforge/public/index.php';
    $item->menu_id = 'agentforge_prepare';
    $item->target = 'mod';
    $event->setMenu([...$event->getMenu(), $item]);
    return $event;
}

$eventDispatcher->addListener(PatientMenuEvent::MENU_UPDATE, 'agentforge_patient_menu_item');
