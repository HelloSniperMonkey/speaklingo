#!/bin/bash

# Start the load balancer

cd "$(dirname "$0")"

echo "Starting Load Balancer on port 8089..."
python loadbalancer.py
