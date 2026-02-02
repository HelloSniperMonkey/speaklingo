#!/bin/bash

# Stop the load balancer

echo "Stopping Load Balancer..."
pkill -f "loadbalancer.py" || echo "Load balancer not running"
